// Remote (external) jobs — NCI Gadi PBS jobs agents register with the Job Service
// (`prepare_remote` / `register_remote`), the owner mailbox cutex watches for PBS mail
// (`/v2/inbound-mail`) and the optional Gadi scheduler check (`/v2/nci-verification`, cutex built with
// `nci-qstat`). Wire names kept. Credentials (the mailbox app password, the SSH private key) are
// write-only: no status shape carries them and main never returns them to the renderer.

/** Job Service accepts owner marking of external jobs (`POST /v2/job-service/mark-external`). */
export const JOB_EXTERNAL_FEATURE = "job-external";
/** cutex has the inbound mailbox (Linux builds). */
export const INBOUND_MAIL_FEATURE = "inbound-mail";
/** `GET /v2/inbound-mail` reports `address` / `nciMailTo*` (what `prepare_remote` hands agents). */
export const NCI_MAIL_ADDRESS_FEATURE = "nci-mail-address";
/** cutex built with `nci-qstat`: Gadi scheduler verification. */
export const NCI_VERIFICATION_FEATURE = "nci-verification";
/** cutex can generate the dedicated Gadi key itself and serve the qstat-only helper (with nci-verification). */
export const NCI_HOST_KEYGEN_FEATURE = "nci-host-keygen";
/** The running Job Service has NCI enabled and this cutex can verify it. */
export const JOB_SOURCE_NCI_FEATURE = "job-source-nci";

/** Why agents do (not) get an NCI notification address (cutex `nciMailToStatus`). */
export type NciMailToStatus = "configured" | "mailbox_not_configured" | "nci_source_disabled" | "receiver_disabled" | "address_required";

/** `GET /v2/inbound-mail` (never a password). */
export interface InboundMailStatus {
  enabled: boolean;
  configured: boolean;
  server: string | null;
  port: number | null;
  username: string | null;
  mailbox: string | null;
  sources: string[];
  /** Explicit NCI address; null = the login name is used when it is an address. */
  address?: string | null;
  /** What `prepare_remote` hands agents as `qsub -M` (null = none; see nciMailToStatus). */
  nciMailTo?: string | null;
  nciMailToStatus?: NciMailToStatus | string;
  nciMailToFrom?: "address" | "username" | null;
  /** The file the Job Service reads (`serve --external-notify-file`). */
  notifyAddressFile?: string | null;
  /** The running Job Service reads that file (else agents get no address whatever is set here). */
  jobServiceNotifyFile?: boolean;
  jobServiceNciSource?: boolean;
  lastConnectedAt: number | null;
  errorCode: string | null;
  deliveryErrorCode?: string | null;
  nciVerificationAvailable?: boolean;
  statusCode?: string | null;
  counts?: Record<string, number>;
}

/** `PUT /v2/inbound-mail/config`. `password` omitted = keep the saved one (same account only). */
export interface InboundMailInput {
  enabled: boolean;
  server: string;
  port: number;
  username: string;
  password?: string;
  mailbox?: string;
  sources?: string[];
  /** Omitted / null = use the login name when it is an address. */
  address?: string | null;
}

/** `GET /v2/nci-verification` (public parts only). */
export interface NciVerificationStatus {
  configured: boolean;
  enabled: boolean;
  host: string;
  pollIntervalSeconds: number;
  minimumQueryIntervalSeconds?: number;
  queryCount?: number;
  errorCode: string | null;
  username?: string | null;
  hostKeys?: string[];
  hostKeyFingerprints?: (string | null)[];
  privateKeyStored?: boolean;
  /** `ALGORITHM BASE64` of the stored key, for Gadi's authorized_keys. */
  publicKey?: string | null;
  publicKeyFingerprint?: string | null;
  /** nci-host-keygen: where the key came from (generated on the host / uploaded key file). */
  keySource?: "generated" | "uploaded" | null;
  /** nci-host-keygen: a generated key not yet in a saved configuration (PUT with `useGeneratedKey`). */
  pendingGeneratedKey?: boolean;
  /**
   * nci-host-keygen: the restricted authorized_keys line with `gadiHomePlaceholder` where the owner's
   * Gadi home goes; null without a key.
   */
  authorizedKeysTemplate?: string | null;
  gadiHomePlaceholder?: string | null;
  trackedJobs?: number;
  lastQueryAt?: number | null;
  lastSuccessAt?: number | null;
  nextQueryAllowedAt?: number | null;
}

/**
 * `PUT /v2/nci-verification/config` as the renderer sends it: no key material. `pickPrivateKey`
 * makes main open a file chooser on this machine and send the chosen OpenSSH key itself.
 */
export interface NciVerificationInput {
  enabled?: boolean;
  username: string;
  hostKeys: string[];
  hostKeyConfirmed: boolean;
  pollIntervalSeconds?: number;
  pickPrivateKey?: boolean;
  /** nci-host-keygen: use the key cutex generated (`POST /v2/nci-verification/key`); exclusive with pickPrivateKey. */
  useGeneratedKey?: boolean;
}

/** `GET /v2/nci-verification/helper` (nci-host-keygen): the reviewed qstat-only helper for Gadi. */
export interface NciHelper {
  fileName: string;
  /** Where it goes on Gadi, e.g. `~/.cutex/nci-qstat-only.py`. */
  installPath: string;
  script: string;
  /** Hex SHA-256 of `script`. */
  sha256: string;
}

export type ExternalTerminalState = "exited" | "failed" | "cancelled";

/** `POST /v2/job-service/mark-external`. */
export interface MarkExternalInput {
  jobId: string;
  expectedRevision: number;
  state: ExternalTerminalState;
  /** Required (>= 0) for `exited`. */
  exitCode?: number;
  /** Private owner audit note (<= 2048 chars). */
  note?: string;
}
