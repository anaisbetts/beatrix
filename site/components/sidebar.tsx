import { MessageSquare } from 'lucide-react'

export default function Sidebar() {
  return (
    <div className="border-border bg-card flex h-full w-64 flex-col border-r">
      <div className="border-border border-b p-4">
        <h1 className="text-xl font-bold">Agentic Automation</h1>
      </div>
      <nav className="flex-1 p-2">
        <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-md p-2 font-medium">
          <MessageSquare size={18} />
          <span>Debug Chat</span>
        </div>
      </nav>
    </div>
  )
}
