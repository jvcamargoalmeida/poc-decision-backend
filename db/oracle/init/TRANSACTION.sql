ALTER SESSION SET CONTAINER = XEPDB1;
ALTER SESSION SET CURRENT_SCHEMA = transaction_app;

CREATE TABLE transactions (
    id VARCHAR2(32) DEFAULT SYS_GUID() PRIMARY KEY,
    amount NUMBER(15, 2) NOT NULL,
    currency VARCHAR2(3) NOT NULL,
    status VARCHAR2(20) DEFAULT 'PENDING' NOT NULL,
    risk_score VARCHAR2(20) NOT NULL,
    idempotency_key VARCHAR2(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indice unico em vez de constraint: no Oracle, indice unico admite multiplos NULLs,
-- entao a chave permanece opcional e linhas sem chave continuam validas. E o proprio
-- banco que garante a unicidade sob concorrencia — a verificacao na aplicacao sozinha
-- nao resolve corrida entre duas requisicoes simultaneas.
CREATE UNIQUE INDEX ux_transactions_idempotency_key ON transactions (idempotency_key);
