// @flow
/* eslint no-console: 0 */

import { ConnectionPool } from 'mssql';

import {
  createConnectionPool,
  type DatabaseConnectionOptions,
  type DbResponse,
} from '../lib/mssql-helpers';

type Opbeat = $Exports<'opbeat'>;

export type AddOrderOptions = {|
  orderID: string,
  orderDate: Date,
  contactName: string,
  contactEmail: string,
  contactPhone: string,
  shippingName: string,
  shippingCompany: string,
  shippingAddr1: string,
  shippingAddr2: string,
  shippingCity: string,
  shippingState: string,
  shippingZIP: string,
  billingName: string,
  billingAddr1: string,
  billingAddr2: string,
  billingCity: string,
  billingState: string,
  billingZIP: string,
  billingLast4: string,
  serviceFee: number,
  idempotencyKey: string,
|};

export type AddOrderResult = {|
  OrderKey: number,
  ErrorMessage: string,
|};

export default class RegistryOrders {
  opbeat: ?Opbeat;
  pool: ConnectionPool;

  constructor(pool: ConnectionPool, opbeat?: Opbeat) {
    this.opbeat = opbeat;
    this.pool = pool;
  }

  async addOrder({
    orderID,
    orderDate,
    contactName,
    contactEmail,
    contactPhone,
    shippingName,
    shippingCompany,
    shippingAddr1,
    shippingAddr2,
    shippingCity,
    shippingState,
    shippingZIP,
    billingName,
    billingAddr1,
    billingAddr2,
    billingCity,
    billingState,
    billingZIP,
    billingLast4,
    serviceFee,
    idempotencyKey,
  }: AddOrderOptions): Promise<number> {
    const transaction =
      this.opbeat &&
      this.opbeat.startTransaction('AddOrder', 'Registry Orders');

    try {
      const resp: DbResponse<AddOrderResult> = (await this.pool
        .request()
        .input('orderID', orderID)
        .input('orderType', 'DC')
        .input('orderDate', orderDate)
        .input('contactName', contactName)
        .input('contactEmail', contactEmail)
        .input('contactPhone', contactPhone)
        .input('shippingName', shippingName)
        .input('shippingCompany', shippingCompany)
        .input('shippingAddr1', shippingAddr1)
        .input('shippingAddr2', shippingAddr2)
        .input('shippingCity', shippingCity)
        .input('shippingState', shippingState)
        .input('shippingZIP', shippingZIP)
        .input('billingName', billingName)
        .input('billingAddr1', billingAddr1)
        .input('billingAddr2', billingAddr2)
        .input('billingCity', billingCity)
        .input('billingState', billingState)
        .input('billingZIP', billingZIP)
        .input('billingLast4', billingLast4)
        .input('serviceFee', `$${serviceFee.toFixed(2)}`)
        .input('idempotencyKey', idempotencyKey)
        .execute('Commerce.sp_AddOrder'): any);

      const { recordset } = resp;

      if (!recordset || recordset.length === 0) {
        throw new Error('Recordset for creating an order came back empty');
      }

      const result = recordset[0];

      if (result.ErrorMessage) {
        throw new Error(result.ErrorMessage);
      }

      return result.OrderKey;
    } finally {
      if (transaction) {
        transaction.end();
      }
    }
  }

  async addItem(
    orderKey: number,
    certificateId: number,
    certificateName: string,
    quantity: number,
    certificateCost: number
  ): Promise<void> {
    const transaction =
      this.opbeat &&
      this.opbeat.startTransaction('AddOrderItem', 'Registry Orders');

    try {
      const resp: DbResponse<Object> = (await this.pool
        .request()
        .input('orderKey', orderKey)
        .input('orderType', 'DC')
        .input('certificateID', certificateId)
        .input('certificateName', certificateName)
        .input('quantity', quantity)
        .input('unitCost', `$${certificateCost.toFixed(2)}`)
        .execute('Commerce.sp_AddOrderItem'): any);

      const { recordset } = resp;

      if (!recordset || recordset.length === 0) {
        throw new Error(
          `Could not add item to order ${orderKey}. Likely no certificate ID ${certificateId} in the database.`
        );
      }
    } finally {
      if (transaction) {
        transaction.end();
      }
    }
  }

  async addPayment(
    orderKey: number,
    paymentDate: Date,
    transactionId: string,
    totalInDollars: number
  ): Promise<void> {
    const transaction =
      this.opbeat &&
      this.opbeat.startTransaction('AddPayment', 'Registry Orders');

    try {
      const resp: DbResponse<Object> = (await this.pool
        .request()
        .input('orderKey', orderKey)
        .input('paymentDate', paymentDate)
        .input('paymentDescription', '')
        .input('transactionID', transactionId)
        .input('paymentAmount', `$${totalInDollars.toFixed(2)}`)
        .execute('Commerce.sp_AddPayment'): any);

      const { recordset } = resp;

      if (!recordset || recordset.length === 0) {
        throw new Error('Recordset for adding payment came back empty');
      }
    } finally {
      if (transaction) {
        transaction.end();
      }
    }
  }
}

export class RegistryOrdersFactory {
  pool: ConnectionPool;
  opbeat: Opbeat;

  constructor(pool: ConnectionPool, opbeat: Opbeat) {
    this.pool = pool;
    this.opbeat = opbeat;
  }

  registryOrders() {
    return new RegistryOrders(this.pool, this.opbeat);
  }

  cleanup(): Promise<any> {
    return this.pool.close();
  }
}

export async function makeRegistryOrdersFactory(
  opbeat: Opbeat,
  connectionOptions: DatabaseConnectionOptions
): Promise<RegistryOrdersFactory> {
  const pool = await createConnectionPool(opbeat, connectionOptions);
  return new RegistryOrdersFactory(pool, opbeat);
}

export class FixtureRegistryOrders {
  async addOrder(): Promise<number> {
    return 50;
  }

  async addOrderItems(): Promise<void> {}
  async addOrderPayment(): Promise<void> {}
}

export async function makeFixtureRegistryOrdersFactory(): Promise<
  RegistryOrdersFactory
> {
  return ({
    registryOrders() {
      return new FixtureRegistryOrders();
    },
  }: any);
}