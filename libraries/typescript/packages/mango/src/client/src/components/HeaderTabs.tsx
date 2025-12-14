import { useEffect } from "react";
import { Code, Layers } from "lucide-react";
import { useAppState } from "../store/app";
import { useChatStream } from "../hooks/useChatStream";

export function HeaderTabs() {
  const activeTab = useAppState((state) => state.activeTab);
  const setActiveTab = useAppState((state) => state.setActiveTab);
  const { clearMessages } = useChatStream();

  // Update tab width when activeTab changes or window resizes
  useEffect(() => {
    const updateTabWidth = () => {
      const container = document.getElementById("tab-container");
      if (container) {
        const activeButton = document.getElementById(`tab-${activeTab}`);

        if (activeButton) {
          container.style.setProperty(
            "--tab-width",
            `${activeButton.offsetWidth + 3}px`
          );
          container.style.setProperty(
            "--tab-offset",
            `${activeButton.offsetLeft - 3}px`
          );
        }
      }
    };

    // Small delay to ensure DOM is updated
    const timeoutId = setTimeout(updateTabWidth, 0);

    // Listen for window resize
    window.addEventListener("resize", updateTabWidth);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updateTabWidth);
    };
  }, [activeTab]);

  return (
    <div className="fixed top-0 z-30 left-0 right-0 opacity-100">
      <header className="flex w-full items-center justify-between px-8 py-3">
        {/* Left side - Logo */}
        <div className="flex items-center gap-10">
          <div className="text-2xl font-semibold">🥭 Mango</div>

          {/* Center - Tabs */}
          <div
            id="tab-container"
            className="relative inline-flex items-center gap-[3px] rounded-[28px] p-[4px] bg-[rgba(221,221,221,0.9)] backdrop-blur-md"
          >
            <div
              className="absolute top-[4px] h-10 rounded-full bg-white z-10 shadow-[rgba(0,0,0,0.1)_0px_1px_8px_0px] transition-all duration-300 ease-out"
              style={{
                width: "var(--tab-width, 120px)",
                transform: "translateX(var(--tab-offset, 0px))",
              }}
            />
            <button
              id="tab-canvas"
              onClick={() => setActiveTab("canvas")}
              className={`relative z-10 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-300 leading-[130%] ${
                activeTab === "canvas"
                  ? "text-[#898315]"
                  : "text-[#777777] hover:text-black"
              }`}
            >
              <Layers className="w-5 h-5" />
              <span>Canvas</span>
            </button>
            <button
              id="tab-editor"
              onClick={() => setActiveTab("editor")}
              className={`relative z-10 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-300 leading-[130%] ${
                activeTab === "editor"
                  ? "text-[#898315]"
                  : "text-[#777777] hover:text-black"
              }`}
            >
              <Code className="w-5 h-5" />
              <span>Editor</span>
            </button>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={clearMessages}
            className="h-10 flex items-center gap-2 rounded-full px-4 text-sm font-medium transition-all duration-200 ease-in-out bg-stone-900 text-stone-100 hover:bg-stone-800"
          >
            <span>Clear Chat</span>
          </button>
        </div>
      </header>
    </div>
  );
}
