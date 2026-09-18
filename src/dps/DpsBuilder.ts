import type { TipoInscricaoFederal } from '../types.js';

export type BuildDpsIdParams = {
  /** IBGE município, 7 dígitos. */
  codigoMunicipioIbge: string;
  /** 1 = CNPJ, 2 = CPF (tpInscr). */
  tipoInscricao: TipoInscricaoFederal;
  /** IE federal (CNPJ/CPF), 14 posições com pad. */
  inscricaoFederal: string;
  /** Série DPS, 5 posições. */
  serie: string;
  /** nDPS, 15 posições. */
  nDps: string | number;
};

export type BuildDpsParams = BuildDpsIdParams & {
  /** Extensível p/ totTrib / IBSCBS (RTC) — não bloqueante neste scaffold. */
  extras?: Record<string, unknown>;
};

export type BuiltDps = {
  id: string;
  xml: string;
  signed: false;
};

function onlyDigits(value: string | number): string {
  return String(value).replace(/\D/g, '');
}

function padDigits(value: string | number, length: number, field: string): string {
  const digits = onlyDigits(value);
  if (digits.length > length) {
    throw new Error(`${field} excede ${length} dígitos`);
  }
  return digits.padStart(length, '0');
}

/**
 * DpsBuilder: monta Id DPS (45) e serializa XML **sem** assinatura.
 *
 * Id = IBGE(7) + tpInscr(1) + IEFed(14) + série(5) + nDPS(15).
 * totTrib por regime e grupo IBSCBS/RTC: DTO extensível, não bloqueia P0.
 */
export class DpsBuilder {
  buildDpsId(params: BuildDpsIdParams): string {
    const ibge = padDigits(params.codigoMunicipioIbge, 7, 'codigoMunicipioIbge');
    const ieFed = padDigits(params.inscricaoFederal, 14, 'inscricaoFederal');
    const serie = padDigits(params.serie, 5, 'serie');
    const nDps = padDigits(params.nDps, 15, 'nDps');
    return `${ibge}${params.tipoInscricao}${ieFed}${serie}${nDps}`;
  }

  buildDps(params: BuildDpsParams): BuiltDps {
    const id = this.buildDpsId(params);
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<DPS Id="${id}">`,
      '  <!-- stub unsigned; XSD em schemas/xsd/ ainda não carregado -->',
      '</DPS>',
      '',
    ].join('\n');
    return { id, xml, signed: false };
  }
}
