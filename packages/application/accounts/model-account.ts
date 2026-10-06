export interface ModelAccountCallback {
  state?: string;
  code?: string;
  client_id?: string;
  error?: string;
}
export interface ModelAccountPorts {
  authorizationUrl(clientId?: string): string;
  activeAccount(): string | null;
  models(): Promise<{ slug: string; name: string }[]>;
  selectAccount(clientId: string): void;
  selectModel(slug: string, available: string[]): void;
  callback(query: ModelAccountCallback): Promise<void>;
  disconnect(): Promise<{ revoked: boolean }>;
  stopGeneration(): void;
  invalidateContext(): void;
}
export class AccountChangedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "계정 또는 모델 선택이 변경됐습니다. 현재 계정에서 다시 시도해 주세요.",
    );
  }
}
/** Owns account-selection effects and rejects results from superseded commands. */
export class ModelAccount {
  private revision = 0;
  constructor(private readonly ports: ModelAccountPorts) {}
  authorize(clientId?: string) {
    const url = this.ports.authorizationUrl(clientId);
    this.revision++;
    return url;
  }
  private changed() {
    this.ports.stopGeneration();
    this.ports.invalidateContext();
  }
  private current(revision: number, account?: string | null) {
    if (
      revision !== this.revision ||
      (account !== undefined && account !== this.ports.activeAccount())
    )
      throw new AccountChangedError();
  }
  async models() {
    const revision = this.revision,
      account = this.ports.activeAccount();
    const models = await this.ports.models();
    this.current(revision, account);
    return models;
  }
  selectAccount(clientId: string) {
    this.revision++;
    this.ports.stopGeneration();
    this.ports.selectAccount(clientId);
    this.ports.invalidateContext();
  }
  async selectModel(slug: string) {
    const revision = ++this.revision,
      account = this.ports.activeAccount();
    this.ports.stopGeneration();
    const models = await this.ports.models();
    this.current(revision, account);
    this.ports.selectModel(
      slug,
      models.map((model) => model.slug),
    );
    // Generation may have been restarted while the model query was pending.
    this.changed();
  }
  async callback(query: ModelAccountCallback) {
    const revision = ++this.revision;
    await this.ports.callback(query);
    // Successful adapter completion has persisted an account. Invalidate even
    // when a later command arrived before this continuation resumed.
    this.changed();
    this.current(revision);
  }
  disconnect() {
    this.revision++;
    this.changed();
    // Adapter clears local secrets before waiting for remote revocation.
    return this.ports.disconnect();
  }
}
