import { Schema, type Document } from 'mongoose';

interface AuditLogDocument extends Document {
    transactionId: string;
    payload: unknown;
    clientId?: string;
    createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>({
    transactionId: { type: String, required: true, unique: true, index: true},
    payload: { type: Schema.Types.Mixed, required: true },
    // Indexado e nao obrigatorio: e o campo que responde "o que este cliente
    // submeteu?", mas documentos gravados antes da credencial por cliente
    // continuam validos sem ele.
    clientId: { type: String, required: false, index: true },
    createdAt: { type: Date, default: Date.now }
});

export { AuditLogDocument, auditLogSchema };