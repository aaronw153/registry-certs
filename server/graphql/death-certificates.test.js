// @flow

import { resolvers } from './death-certificates';

import Registry from '../services/__mocks__/Registry';

describe('DeathCertificates resolvers', () => {
  describe('search', () => {
    it('returns search results', async () => {
      const certs = await resolvers.DeathCertificates.search({}, { query: 'Logan' }, ({ registry: new Registry() }: any));
      expect(certs.length).toEqual(3);
    });
  });

  describe('certificate', () => {
    it('returns a specific certificate', () => {
      expect(resolvers.DeathCertificates.certificate({}, { id: '000002' })).toBeDefined();
    });

    it('returns null if the certificate is not found', () => {
      expect(resolvers.DeathCertificates.certificate({}, { id: '999992' })).not.toBeDefined();
    });
  });

  describe('certificates', () => {
    it('returns certificates in order', () => {
      const certificates = resolvers.DeathCertificates.certificates({}, { ids: ['000002', '999992', '000001'] });
      expect(certificates[0]).toBeDefined();
      expect(certificates[1]).not.toBeDefined();
      expect(certificates[2]).toBeDefined();
    });
  });
});
