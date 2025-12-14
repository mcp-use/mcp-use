import { create } from "zustand";

export interface AppState {
  activeTab: "canvas" | "editor";
  chatWidth: number;
  canvasPosition: { x: number; y: number };
  canvasScale: number;
  mcpPrimitives: {
    tools: any[];
    resources: any[];
    prompts: any[];
  };
  selectedFile: string | null;
  fileContents: Map<string, string>;
  devServerUrl: string | null;
  setActiveTab: (tab: "canvas" | "editor") => void;
  setChatWidth: (width: number) => void;
  setCanvasPosition: (position: { x: number; y: number }) => void;
  setCanvasScale: (scale: number) => void;
  setMcpPrimitives: (primitives: {
    tools?: any[];
    resources?: any[];
    prompts?: any[];
  }) => void;
  setSelectedFile: (file: string | null) => void;
  setFileContent: (file: string, content: string) => void;
  setDevServerUrl: (url: string | null) => void;
}

export const useAppState = create<AppState>((set) => ({
  activeTab: "canvas",
  chatWidth: 400,
  canvasPosition: { x: 0, y: -260 },
  canvasScale: 1,
  mcpPrimitives: {
    tools: [],
    resources: [],
    prompts: [],
  },
  selectedFile: null,
  fileContents: new Map(),
  devServerUrl: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setChatWidth: (width) => set({ chatWidth: width }),
  setCanvasPosition: (position) => set({ canvasPosition: position }),
  setCanvasScale: (scale) => set({ canvasScale: scale }),
  setMcpPrimitives: (primitives) =>
    set((state) => ({
      mcpPrimitives: {
        tools: primitives.tools ?? state.mcpPrimitives.tools,
        resources: primitives.resources ?? state.mcpPrimitives.resources,
        prompts: primitives.prompts ?? state.mcpPrimitives.prompts,
      },
    })),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setFileContent: (file, content) =>
    set((state) => {
      const newContents = new Map(state.fileContents);
      newContents.set(file, content);
      return { fileContents: newContents };
    }),
  setDevServerUrl: (url) => set({ devServerUrl: url }),
}));
