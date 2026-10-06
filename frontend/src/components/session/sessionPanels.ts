// Which of the four swappable views the session room sidebar is showing.
// `null` = no panel open, the video stage uses the full width.
//
// 'whiteboard' is the odd one out: it does not render in the sidebar at all, it
// takes over the main canvas (see WhiteboardStage). It shares this state so the
// bottom bar's active-state highlighting and the "switch without closing first"
// behaviour work uniformly across all four.
export type SidebarPanel = 'assistant' | 'notes' | 'whiteboard' | 'modules' | null
