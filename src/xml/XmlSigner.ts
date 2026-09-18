import { gzipSync } from 'node:zlib';
import { NotImplementedError } from '../errors.js';
import type { LoadedCertificate } from '../certificado/Certificado.js';

/**
 * Stub de XMLDSig (RSA-SHA256, exclusive c14n, enveloped).
 * `toGZipB64` já comprime: GZip → base64binary (envelope JSON SEFIN).
 *
 * Assinatura real + mTLS ficam para o spike A1 — não neste scaffold.
 */
export class XmlSigner {
  signDpsXml(_xml: string, _cert: LoadedCertificate): string {
    throw new NotImplementedError(
      'XmlSigner',
      'signDpsXml stub — XMLDSig ainda não implementado',
    );
  }

  signPedRegEventoXml(_xml: string, _cert: LoadedCertificate): string {
    throw new NotImplementedError(
      'XmlSigner',
      'signPedRegEventoXml stub — XMLDSig ainda não implementado',
    );
  }

  toGZipB64(xml: string): string {
    return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
  }
}
