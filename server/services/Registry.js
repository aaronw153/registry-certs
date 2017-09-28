// @flow

import { ConnectionPool } from 'mssql';
import type { ConnectionPoolConfig } from 'mssql';

import fs from 'fs';
import DataLoader from 'dataloader';

type Opbeat = $Exports<'opbeat'>;

type DbResponse<R> = {|
  recordsets: Array<Array<R>>,
  recordset: Array<R>,
  output: Object,
  rowsAffected: Array<number>,
|};

export type DeathCertificate = {|
  CertificateID: number,
  'Registered Number': string,
  InOut: 'I' | '*' | '#',
  'Date of Death': ?string,
  'Decedent Name': string,
  'Last Name': string,
  'First Name': string,
  RegisteredYear: string,
  AgeOrDateOfBirth: string,
  Pending: number,
|};

export type DeathCertificateSearchResult = {|
  ...DeathCertificate,
  ResultCount: number,
|};

const MAX_ID_LOOKUP_LENGTH = 1000;

// Converts a list of key strings into an array of comma-separated strings,
// each no longer than maxLength.
//
// E.g.: ["12345", "67890", "abcde"] => ["12345,67890", "abcde"]
export function splitKeys(
  maxLength: number,
  keys: Array<string>
): Array<string> {
  const keyStrings: Array<string> = [];
  let currentKeyString = '';

  keys.forEach(key => {
    if (currentKeyString.length === 0) {
      currentKeyString = key;
    } else if (currentKeyString.length + key.length + 1 < maxLength) {
      currentKeyString = `${currentKeyString},${key}`;
    } else {
      keyStrings.push(currentKeyString);
      currentKeyString = key;
    }
  });

  if (currentKeyString.length > 0) {
    keyStrings.push(currentKeyString);
  }

  return keyStrings;
}

export default class Registry {
  opbeat: ?Opbeat;
  pool: ConnectionPool;
  lookupLoader: DataLoader<string, ?DeathCertificate>;

  constructor(pool: ConnectionPool, opbeat?: Opbeat) {
    this.opbeat = opbeat;
    this.pool = pool;
    this.lookupLoader = new DataLoader(keys => this.lookupLoaderFetch(keys));
  }

  async search(
    name: string,
    page: number,
    pageSize: number,
    startYear: ?string,
    endYear: ?string
  ): Promise<Array<DeathCertificateSearchResult>> {
    const transaction =
      this.opbeat &&
      this.opbeat.startTransaction('FindCertificatesWeb', 'Registry');

    try {
      const resp: DbResponse<DeathCertificateSearchResult> = (await this.pool
        .request()
        .input('searchFor', name)
        .input('pageNumber', page)
        .input('pageSize', pageSize)
        .input('sortBy', 'dateOfDeath')
        .input('startYear', startYear)
        .input('endYear', endYear)
        .execute('Registry.Death.sp_FindCertificatesWeb'): any);

      const { recordset } = resp;

      if (!recordset) {
        throw new Error('Recordset for search came back empty');
      }

      return recordset;
    } finally {
      if (transaction) {
        transaction.end();
      }
    }
  }

  async lookup(id: string): Promise<?DeathCertificate> {
    return this.lookupLoader.load(id);
  }

  // "any" here is really ?DeathCertificate | Error
  async lookupLoaderFetch(keys: Array<string>): Promise<Array<any>> {
    // The api can only take 1000 characters of keys at once. We probably won't
    // run into that issue but just in case we split up and parallelize.
    const keyStrings = splitKeys(MAX_ID_LOOKUP_LENGTH, keys);

    const idToOutputMap: { [key: string]: ?DeathCertificate | Error } = {};

    const allResults: Array<Array<DeathCertificate>> = await Promise.all(
      keyStrings.map(async keyString => {
        const transaction =
          this.opbeat &&
          this.opbeat.startTransaction('GetCertificatesWeb', 'Registry');
        try {
          const resp: DbResponse<DeathCertificate> = (await this.pool
            .request()
            .input('idList', keyString)
            .execute('Registry.Death.sp_GetCertificatesWeb'): any);

          return resp.recordset;
        } catch (err) {
          keyString.split(',').forEach(id => (idToOutputMap[id] = err));
          return [];
        } finally {
          if (transaction) {
            transaction.end();
          }
        }
      })
    );

    allResults.forEach(results => {
      results.forEach((cert: DeathCertificate) => {
        idToOutputMap[cert.CertificateID.toString()] = cert;
      });
    });

    return keys.map(k => idToOutputMap[k]);
  }
}

export class RegistryFactory {
  pool: ConnectionPool;
  opbeat: Opbeat;

  constructor(pool: ConnectionPool, opbeat: Opbeat) {
    this.pool = pool;
    this.opbeat = opbeat;
  }

  registry() {
    return new Registry(this.pool, this.opbeat);
  }

  cleanup(): Promise<any> {
    return this.pool.close();
  }
}

export type MakeRegistryOptions = {|
  user: ?string,
  password: ?string,
  server: ?string,
  domain: ?string,
  database: ?string,
|};

export async function makeRegistryFactory(
  opbeat: Opbeat,
  { user, password, server, domain, database }: MakeRegistryOptions
): Promise<RegistryFactory> {
  if (!(user && password && server && database)) {
    throw new Error('Missing some element of database configuration');
  }

  const opts: ConnectionPoolConfig = {
    user,
    password,
    server,
    database,
    pool: {
      min: 0,
      // Keeps the acquisition from looping forever if there's a failure.
      acquireTimeoutMillis: 10000,
    },
    options: {
      encrypt: true,
    },
  };

  if (domain) {
    opts.domain = domain;
  }

  const pool = new ConnectionPool(opts);

  // We need an error event handler to prevent default Node EventEmitter from
  // crashing the connection pool by throwing any emitted 'error' events that
  // aren't being listened to.
  //
  // On top of that, we need to report to Opbeat because the only permanent
  // errors that will filter up to the GraphQL error reporting are pool timeout
  // errors.
  pool.on('error', err => {
    opbeat.captureError(err);
  });

  await pool.connect();

  return new RegistryFactory(pool, opbeat);
}

export class FixtureRegistry {
  data: Array<DeathCertificateSearchResult>;

  constructor(data: Array<DeathCertificateSearchResult>) {
    this.data = data;
  }

  async search(
    query: string,
    page: number,
    pageSize: number
  ): Promise<Array<DeathCertificateSearchResult>> {
    return this.data.slice(page * pageSize, (page + 1) * pageSize);
  }

  async lookup(id: string): Promise<?DeathCertificateSearchResult> {
    return this.data.find(res => res.CertificateID.toString() === id);
  }
}

export function makeFixtureRegistryFactory(
  fixtureName: string
): Promise<RegistryFactory> {
  return new Promise((resolve, reject) => {
    fs.readFile(fixtureName, (err, data) => {
      if (err) {
        reject(err);
      } else {
        try {
          const json = JSON.parse(data.toString('utf-8'));

          resolve(
            ({
              registry() {
                return new FixtureRegistry(json);
              },

              cleanup() {
                return Promise.resolve(null);
              },
            }: any)
          );
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
