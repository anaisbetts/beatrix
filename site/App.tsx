import Sidebar from '@/components/sidebar'
import Chat from '@/components/chat'

export default function Home() {
  return (
    <div className="bg-background flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Chat />
      </main>
    </div>
  )
}
