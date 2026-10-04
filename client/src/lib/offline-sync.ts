// Offline sync service using IndexedDB
const DB_NAME = "DDS_OFFLINE_DB"
const DB_VERSION = 1
const STORE_NAME = "offline_queue"

interface OfflineItem {
  id: string
  endpoint: string
  method: string
  body: any
  timestamp: number
  retryCount: number
}

class OfflineSyncService {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
          store.createIndex("timestamp", "timestamp", { unique: false })
        }
      }
    })
  }

  async queueItem(endpoint: string, method: string, body: any): Promise<string> {
    if (!this.db) await this.init()

    const item: OfflineItem = {
      id: crypto.randomUUID(),
      endpoint,
      method,
      body,
      timestamp: Date.now(),
      retryCount: 0,
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.add(item)

      request.onsuccess = () => resolve(item.id)
      request.onerror = () => reject(request.error)
    })
  }

  async getQueue(): Promise<OfflineItem[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async removeItem(id: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async syncQueue(token: string): Promise<{ success: number; failed: number }> {
    const queue = await this.getQueue()
    let success = 0
    let failed = 0

    for (const item of queue) {
      try {
        const response = await fetch(`/api${item.endpoint}`, {
          method: item.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(item.body),
        })

        if (response.ok) {
          await this.removeItem(item.id)
          success++
        } else {
          failed++
        }
      } catch (error) {
        failed++
      }
    }

    return { success, failed }
  }

  getQueueSize(): Promise<number> {
    if (!this.db) return this.init().then(() => this.getQueueSize())

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.count()

      request.onsuccess = () => resolve(request.result || 0)
      request.onerror = () => reject(request.error)
    })
  }
}

export const offlineSync = new OfflineSyncService()
