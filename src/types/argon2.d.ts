declare module "argon2" {
  interface Options {
    type?: number;
    timeCost?: number;
    memoryCost?: number;
    parallelism?: number;
    hashLength?: number;
    version?: number;
    raw?: boolean;
    salt?: Buffer;
  }
  export const argon2id: number;
  export function hash(
    password: string | Buffer,
    options?: Options
  ): Promise<string>;
  export function verify(
    hash: string,
    password: string | Buffer,
    options?: Options
  ): Promise<boolean>;
  const _default: {
    hash: typeof hash;
    verify: typeof verify;
    argon2id: number;
  };
  export default _default;
}
