// Small per-viewer UI preferences. The top header is hidden by default and can be popped on and off from the sidebar.
import { create } from 'zustand'

const KEY = 'header-visible'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false // storage blocked: use the default (hidden)
  }
}

interface UiState {
  headerVisible: boolean
  toggleHeader: () => void
}

export const useUi = create<UiState>((set, get) => ({
  headerVisible: read(),
  toggleHeader: () => {
    const next = !get().headerVisible
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      /* storage blocked */
    }
    set({ headerVisible: next })
  },
}))
