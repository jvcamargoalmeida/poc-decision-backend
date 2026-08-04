import {Transaction} from "@/domain/entities/Transaction";
import { TransactionStatus } from "@/domain/enums/TransactionStatus";

interface ITransactionRepository {
    /**
     * Salva uma nova transação no banco de dados.
     * @param transaction Entidade de transação com as regras de negócio aplicadas
    */
    save(transaction: Transaction): Promise<Transaction>;

    /**
     * Busca uma transação pelo seu ID.
     * @param id ID da transação a ser buscada
     * @returns A transação encontrada ou null se não existir
    */
    findById(id: string): Promise<Transaction | null>;

    /**
     * Atualiza o status de uma transação existente (ex.: callback do n8n).
     * @param id ID da transação a ser atualizada
     * @param status Novo status da transação
    */
    updateStatus(id: string, status: TransactionStatus): Promise<void>;
}

export { ITransactionRepository };