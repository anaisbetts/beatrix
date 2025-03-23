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
import { useCallback } from 'react'

function AppSidebar() {
  const { open, isMobile, toggleSidebar } = useSidebar()

  const headerContent =
    open || isMobile ? (
      <h2 className="text-2xl text-nowrap">Agentic Automation</h2>
    ) : null

  const nav = useCallback(() => {
    if (isMobile) toggleSidebar()
  }, [isMobile])

  return (
    <>
      <SidebarHeader>{headerContent}</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="#" onClick={nav}>
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

  return (
    <div className="bg-background h-screen">
      <SidebarProvider defaultOpen={defaultOpen}>
        <Sidebar variant="floating" collapsible="icon">
          <AppSidebar />
        </Sidebar>
        <main>
          <SidebarTrigger />
          <h2 className="text-2xl">content</h2>
        </main>
      </SidebarProvider>
    </div>
  )
}
