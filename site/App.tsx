import Chat from '@/components/chat'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './components/ui/sidebar'
import { MessageSquare } from 'lucide-react'
import { useIsMobile } from './hooks/use-mobile'
import { useCallback, useMemo, useState } from 'react'

interface AppSidebarProps {
  onPageClicked: (page: string) => unknown
}

function AppSidebar({ onPageClicked }: AppSidebarProps) {
  const { open, isMobile, toggleSidebar } = useSidebar()

  const headerContent =
    open || isMobile ? (
      <h2 className="text-2xl text-nowrap">Agentic Automation</h2>
    ) : null

  const nav = useCallback(
    (page: string) => {
      if (isMobile) toggleSidebar()

      onPageClicked(page)
    },
    [isMobile]
  )

  const bg = isMobile ? 'bg-white' : ''

  return (
    <>
      <SidebarHeader className={bg}></SidebarHeader>
      <SidebarContent className={bg}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="#" onClick={() => nav('debug')}>
                    <MessageSquare size={18} />
                    <span className="ms-1">Debug Chat</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  )
}

export default function Home() {
  const defaultOpen = useIsMobile()
  const [page, setPage] = useState('debug')

  const mainContent = useMemo(() => {
    switch (page) {
      case 'debug':
        return <Chat />
      default:
        throw new Error('u blew it')
    }
  }, [page])

  return (
    <div className="bg-background h-screen">
      <SidebarProvider defaultOpen={defaultOpen}>
        <Sidebar variant="floating" collapsible="icon">
          <AppSidebar onPageClicked={setPage} />
        </Sidebar>
        <main className="w-full flex-1">
          <SidebarTrigger className="absolute top-2 right-2" />
          <div className="h-full pr-8">{mainContent}</div>
        </main>
      </SidebarProvider>
    </div>
  )
}
