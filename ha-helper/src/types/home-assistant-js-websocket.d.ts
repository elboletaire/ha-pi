declare module "home-assistant-js-websocket" {
  export interface Connection {
    close(): void;
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
    subscribeEvents(
      onEvent: (event: unknown) => void,
      eventType?: string,
    ): Promise<() => void | Promise<void>>;
  }

  export function createLongLivedTokenAuth(
    url: string,
    token: string,
  ): Promise<unknown>;

  export function createConnection(options: { auth: unknown }): Promise<Connection>;
}
