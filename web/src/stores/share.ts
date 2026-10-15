import { create } from 'zustand';

/** Состояние share-ссылки текущего workflow. */
interface ShareState {
  /**
   * Токен активной share-ссылки.
   *
   * Backend не отдаёт существующий токен в `GET /workflow/:id` (capability:
   * знает только владелец в момент создания), поэтому состояние живёт в памяти
   * сессии: после F5 ссылка «неизвестна», и модалка предложит создать новую
   * (создание перевыпускает токен — KI-237).
   */
  shareToken: string | null;
  /** Запоминает токен после создания (или сбрасывает при отзыве). */
  setShareToken: (shareToken: string | null) => void;
}

/** Стор share-ссылки. */
export const useShareStore = create<ShareState>((set) => ({
  shareToken: null,
  setShareToken: (shareToken) => set({ shareToken }),
}));
