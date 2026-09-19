export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
}

export class MemoryManager {
  private records: Map<string, MemoryRecord> = new Map();

  async saveMemory(userId: string, text: string): Promise<string> {
    const id = `mem_${Date.now()}`;
    this.records.set(id, { id, userId, content: text });
    return id;
  }
}

export function recall(userId: string): MemoryRecord[] {
  return [];
}
