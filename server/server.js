// @flow
/* eslint no-console: 0 */
import Hapi from 'hapi';
import Good from 'good';
import next from 'next';
import Boom from 'boom';
import Inert, { type ReplyWithInert } from 'inert';
import fs from 'fs';
import Path from 'path';
import { graphqlHapi, graphiqlHapi } from 'apollo-server-hapi';
import cleanup from 'node-cleanup';
import makeStripe from 'stripe';

import { nextHandler, nextDefaultHandler } from './lib/next-handlers';
import addRequestAdditions from './lib/request-additions';
import decryptEnv from './lib/decrypt-env';
import {
  opbeatWrapGraphqlOptions,
  reportDeployToOpbeat,
} from './lib/opbeat-utils';

import {
  makeRegistryDataFactory,
  makeFixtureRegistryDataFactory,
  type RegistryDataFactory,
} from './services/RegistryData';

import {
  makeRegistryOrdersFactory,
  makeFixtureRegistryOrdersFactory,
  type RegistryOrdersFactory,
} from './services/RegistryOrders';

import schema from './graphql';
import type { Context } from './graphql';

type Opbeat = $Exports<'opbeat'>;

type ServerArgs = {
  opbeat: Opbeat,
};

const port = parseInt(process.env.PORT || '3000', 10);

export function makeServer({ opbeat }: ServerArgs) {
  const server = new Hapi.Server();

  if (process.env.USE_SSL) {
    const tls = {
      key: fs.readFileSync('server.key'),
      cert: fs.readFileSync('server.crt'),
    };

    server.connection({ port, tls }, '0.0.0.0');
  } else {
    server.connection({ port }, '0.0.0.0');
  }

  const app = next({
    dev: process.env.NODE_ENV !== 'production',
    quiet: process.env.NODE_ENV === 'test',
  });

  const registryDataFactoryOpts = {
    user: process.env.REGISTRY_DATA_DB_USER,
    password: process.env.REGISTRY_DATA_DB_PASSWORD,
    domain: process.env.REGISTRY_DATA_DB_DOMAIN,
    server: process.env.REGISTRY_DATA_DB_SERVER,
    database: process.env.REGISTRY_DATA_DB_DATABASE,
  };

  const registryOrdersFactoryOpts = {
    user: process.env.REGISTRY_ORDERS_DB_USER,
    password: process.env.REGISTRY_ORDERS_DB_PASSWORD,
    domain: process.env.REGISTRY_ORDERS_DB_DOMAIN,
    server: process.env.REGISTRY_ORDERS_DB_SERVER,
    database: process.env.REGISTRY_ORDERS_DB_DATABASE,
  };

  const stripe = makeStripe(process.env.STRIPE_SECRET_KEY || 'fake-secret-key');

  let registryDataFactory: RegistryDataFactory;
  let registryOrdersFactory: RegistryOrdersFactory;

  const startup = async () => {
    const services = await Promise.all([
      registryDataFactoryOpts.server
        ? makeRegistryDataFactory(opbeat, registryDataFactoryOpts)
        : makeFixtureRegistryDataFactory('fixtures/registry-data/smith.json'),
      registryOrdersFactoryOpts.server
        ? makeRegistryOrdersFactory(opbeat, registryOrdersFactoryOpts)
        : makeFixtureRegistryOrdersFactory(),
      app.prepare(),
    ]);

    registryDataFactory = services[0];
    registryOrdersFactory = services[1];

    return async () => {
      await Promise.all([
        registryDataFactory.cleanup(),
        registryOrdersFactory.cleanup(),
        app.close(),
        server.stop(),
      ]);
    };
  };

  server.auth.scheme(
    'headerKeys',
    (s, { keys, header }: { header: string, keys: string[] }) => ({
      authenticate: (request, reply) => {
        const key = request.headers[header.toLowerCase()];
        if (!key) {
          reply(Boom.unauthorized(`Missing ${header} header`));
        } else if (keys.indexOf(key) === -1) {
          reply(Boom.unauthorized(`Key ${key} is not a valid key`));
        } else {
          reply.continue({ credentials: key });
        }
      },
    })
  );

  server.auth.strategy('apiKey', 'headerKeys', {
    header: 'X-API-KEY',
    keys: process.env.API_KEYS
      ? process.env.API_KEYS.split(',')
      : ['test-api-key'],
  });

  if (process.env.NODE_ENV !== 'test') {
    server.register({
      register: Good,
      options: {
        reporters: {
          console: [
            {
              module: 'good-squeeze',
              name: 'Squeeze',
              args: [
                {
                  // Keep our health checks from appearing in logs
                  response: { exclude: 'health' },
                  log: '*',
                },
              ],
            },
            {
              module: 'good-console',
              args: [
                {
                  color: process.env.NODE_ENV !== 'production',
                },
              ],
            },
            'stdout',
          ],
        },
      },
    });
  }

  server.register(Inert);

  server.register({
    register: graphqlHapi,
    options: {
      path: '/graphql',
      // We use a function here so that all of our services are request-scoped
      // and can cache within the same query but not leak to others.
      graphqlOptions: opbeatWrapGraphqlOptions(opbeat, () => ({
        schema,
        context: ({
          registryData: registryDataFactory.registryData(),
          registryOrders: registryOrdersFactory.registryOrders(),
          stripe,
          opbeat: ({}: any),
        }: Context),
      })),
      route: {
        cors: true,
        auth: 'apiKey',
      },
    },
  });

  server.register({
    register: graphiqlHapi,
    options: {
      path: '/graphiql',
      graphiqlOptions: {
        endpointURL: '/graphql',
        passHeader: `'X-API-KEY': '${process.env.WEB_API_KEY ||
          'test-api-key'}'`,
      },
    },
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: (request, reply) => reply.redirect('/death'),
  });

  server.route({
    method: 'GET',
    path: '/admin/ok',
    handler: (request, reply) => reply('ok'),
    config: {
      // mark this as a health check so that it doesn’t get logged
      tags: ['health'],
    },
  });

  server.route({
    method: 'GET',
    path: '/death/certificate/{id}',
    handler: addRequestAdditions(nextHandler(app, '/death/certificate')),
  });

  server.route({
    method: 'GET',
    path: '/{p*}',
    handler: addRequestAdditions(nextHandler(app)),
  });

  server.route({
    method: 'GET',
    path: '/_next/{p*}',
    handler: nextDefaultHandler(app),
  });

  server.route({
    method: 'GET',
    path: '/assets/{path*}',
    handler: (request, reply: any) => {
      if (!request.params.path || request.params.path.indexOf('..') !== -1) {
        return reply(Boom.forbidden());
      }

      const p = Path.join(
        'static',
        'assets',
        ...request.params.path.split('/')
      );

      return (reply: ReplyWithInert)
        .file(p)
        .header('Cache-Control', 'public, max-age=3600, s-maxage=600');
    },
  });

  server.route({
    method: 'GET',
    path: '/storybook/{path*}',
    handler: {
      directory: {
        path: 'storybook-static',
      },
    },
  });

  return {
    server,
    startup,
  };
}

export default async function startServer(args: ServerArgs) {
  await decryptEnv();

  reportDeployToOpbeat(args.opbeat, process.env.OPBEAT_APP_ID);
  reportDeployToOpbeat(args.opbeat, process.env.OPBEAT_FRONTEND_APP_ID);

  const { server, startup } = makeServer(args);

  const shutdown = await startup();
  cleanup(exitCode => {
    shutdown().then(
      () => {
        process.exit(exitCode);
      },
      err => {
        console.log('CLEAN EXIT FAILED', err);
        process.exit(-1);
      }
    );

    cleanup.uninstall();
    return false;
  });

  await server.start();

  console.log(`> Ready on http://localhost:${port}`);
}
