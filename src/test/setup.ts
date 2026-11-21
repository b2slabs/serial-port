import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// `globals: false` means Testing Library's auto-cleanup (which looks for a
// global `afterEach`) doesn't register itself, so wire it up explicitly.
afterEach(() => {
  cleanup()
})
