// @flow

import { makeExecutableSchema } from 'graphql-tools';
import type { NodeStripe } from 'stripe';
import type Rollbar from 'rollbar';

import { Schema as QuerySchema, resolvers as queryResolvers } from './query';
import {
  Schema as MutationSchema,
  resolvers as mutationResolvers,
} from './mutation';
import {
  Schema as DeathSchema,
  resolvers as deathResolvers,
} from './death-certificates';

import type RegistryData from '../services/RegistryData';
import type RegistryOrders from '../services/RegistryOrders';
import type Emails from '../services/Emails';

export type Context = {|
  rollbar: Rollbar,
  registryData: RegistryData,
  registryOrders: RegistryOrders,
  stripe: NodeStripe,
  emails: Emails,
|};

const SchemaDefinition = `
schema {
  query: Query,
  mutation: Mutation,
}
`;

export default makeExecutableSchema({
  typeDefs: [SchemaDefinition, QuerySchema, MutationSchema, DeathSchema],
  resolvers: {
    ...queryResolvers,
    ...mutationResolvers,
    ...deathResolvers,
  },
  allowUndefinedInResolve: false,
});
