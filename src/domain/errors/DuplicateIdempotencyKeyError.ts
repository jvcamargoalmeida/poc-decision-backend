import { DomainError } from '@/domain/errors/DomainError';

/**
 * Sinaliza que já existe transação gravada com a mesma chave de idempotência.
 *
 * Existe para que o repositório traduza a violação de constraint única do Oracle
 * (`ORA-00001`) em um conceito de domínio: sem isso, o caso de uso precisaria
 * conhecer códigos de erro do driver para reagir, invertendo a direção da
 * dependência entre as camadas.
 */
class DuplicateIdempotencyKeyError extends DomainError {
  constructor(public readonly idempotencyKey: string) {
    super(`Já existe transação para a chave de idempotência ${idempotencyKey}`);
  }
}

export { DuplicateIdempotencyKeyError };
