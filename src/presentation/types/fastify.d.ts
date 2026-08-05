import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Identificador do cliente resolvido pelo `clientAuthHook` a partir da
     * credencial apresentada. Fica opcional porque rotas públicas (`/health`) e o
     * callback do n8n não passam por esse hook.
     */
    clientId?: string;
  }
}
