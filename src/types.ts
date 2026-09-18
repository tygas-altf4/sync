export type Ambiente = 'ProducaoRestrita' | 'Producao';

/** Valor persistido em `nfse_docs.environment`. */
export type NfseEnvironment = 'restrita' | 'producao';

export type Channel = 'nacional' | 'campinas' | 'sao_paulo' | 'outro';

export type PlanCode = 'free50' | 'starter89' | 'pro249' | 'scale549';

export type NfseDocStatus =
  | 'autorizada'
  | 'rejeitada'
  | 'cancelada'
  | 'substituida'
  | 'pendente';

export type TipoInscricaoFederal = '1' | '2';
