import {Transaction} from "@/domain/entities/Transaction";

interface ITransactionRepository {
    /**
     * Salva uma nova transação no banco de dados.
     * @param transaction Entidade de transação com as regras de negócio aplicadas
    */
    save(transaction: Transaction): Promise<void>;

    /**
     * Busca uma transação pelo seu ID.
     * @param id ID da transação a ser buscada
     * @returns A transação encontrada ou null se não existir
    */
    findById(id: string): Promise<Transaction | null>;
}

export { ITransactionRepository };