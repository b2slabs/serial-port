import { ConnectionStoreProvider } from './store/ConnectionStoreProvider'
import { ConnectionControls } from './components/ConnectionControls'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SerialTerminal } from './components/SerialTerminal'

function App() {
  return (
    <ConnectionStoreProvider>
      <div className="flex h-full flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <ConnectionControls />
          <ConnectionStatus />
        </header>
        <main className="min-h-0 flex-1">
          <SerialTerminal />
        </main>
      </div>
    </ConnectionStoreProvider>
  )
}

export default App
