import asyncio
import hashlib
import json
import time
import sys
from collections import OrderedDict
from typing import Any, Callable

# --- COLORS FOR PRO OUTPUT ---
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def print_slow(text, delay=0.03):
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print() # Print a new line at the end

# --- 1. MOCK INFRASTRUCTURE ---
class MiddlewareContext:
    def __init__(self, name: str, arguments: dict[str, Any]):
        self.name = name
        self.arguments = arguments

class Middleware:
    def __init__(self): pass
    async def on_call_tool(self, context: MiddlewareContext, call_next: Callable):
        return await call_next(context)

# --- 2. THE NEW LRU CACHING MIDDLEWARE (Aligned with your PR) ---
class ToolResultCachingMiddleware(Middleware):
    def __init__(self, max_size: int = 1000):
        super().__init__()
        self._max_size = max_size
        # Use OrderedDict for LRU behavior
        self._cache: OrderedDict[str, Any] = OrderedDict()

    def _generate_cache_key(self, tool_name: str, arguments: dict[str, Any]) -> str:
        payload = json.dumps(arguments, sort_keys=True, default=str)
        key_content = f"{tool_name}:{payload}"
        return hashlib.sha256(key_content.encode()).hexdigest()

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        tool_name = context.name
        
        # VISUAL LOGGING
        print(f"{Colors.CYAN}   [Middleware] Intercepting call to '{tool_name}'...{Colors.ENDC}")
        
        cache_key = self._generate_cache_key(tool_name, context.arguments)

        if cache_key in self._cache:
            # LRU Logic: Move to end (mark as recently used)
            self._cache.move_to_end(cache_key)
            print(f"{Colors.GREEN}   ✨ [CACHE HIT] Serving from memory (0ms latency){Colors.ENDC}")
            return self._cache[cache_key], True 

        print(f"{Colors.WARNING}   ⚡ [CACHE MISS] Executing upstream tool...{Colors.ENDC}")
        result = await call_next(context)
        
        # Cache Logic
        self._cache[cache_key] = result
        self._cache.move_to_end(cache_key)
        if len(self._cache) > self._max_size:
            self._cache.popitem(last=False) # Evict oldest
            
        return result, False

# --- 3. DEMO RUNNER ---
async def main():
    print_slow(f"\n{Colors.HEADER}{Colors.BOLD}🚀 MCP AGENT OPTIMIZATION DEMO: LRU Caching Test{Colors.ENDC}")
    print(f"{Colors.HEADER}====================================================={Colors.ENDC}\n")
    
    # Initialize with LRU logic
    caching_layer = ToolResultCachingMiddleware(max_size=100)
    
    simulated_tool_delay = 5.0  # 15 Seconds
    
    time_without_cache = 0.0
    time_with_cache = 0.0

    async def heavy_stock_tool(ctx):
        ticker = ctx.arguments['ticker']
        print_slow(f"      {Colors.BLUE}⟳  Connecting to API for ${ticker}...{Colors.ENDC}")
        await asyncio.sleep(simulated_tool_delay) 
        return {"ticker": ticker, "price": 150.00}

    requests = [
        {"ticker": "AAPL"},  # New (15s)
        {"ticker": "AAPL"},  # Repeat (0s)
        {"ticker": "GOOGL"}, # New (15s)
        {"ticker": "AAPL"},  # Repeat (0s)
        {"ticker": "GOOGL"}, # Repeat (0s)
        {"ticker": "TSLA"},  # New (15s)
    ]

    for i, args in enumerate(requests, 1):
        ticker = args['ticker']
        print_slow(f"{Colors.BOLD}🔹 Request #{i}: Get Analysis for ${ticker}{Colors.ENDC}")
        
        context = MiddlewareContext(name="get_stock_analysis", arguments=args)
        start_time = time.time()
        
        result, is_cached = await caching_layer.on_call_tool(context, heavy_stock_tool)
        
        duration = time.time() - start_time
        time_with_cache += duration
        time_without_cache += simulated_tool_delay 
        
        if is_cached:
            print(f"   ✅ Completed in {Colors.GREEN}{duration:.4f}s{Colors.ENDC} (Instant)")
        else:
            print(f"   ✅ Completed in {Colors.FAIL}{duration:.2f}s{Colors.ENDC} (Heavy Load)")
        
        print("-" * 40)
        time.sleep(0.5) 

    # --- CALCULATE IMPACT ---
    saved_seconds = time_without_cache - time_with_cache
    percentage_saved = (saved_seconds / time_without_cache) * 100
    speedup_factor = time_without_cache / time_with_cache

    print_slow(f"\n{Colors.HEADER}📊 IMPACT REPORT{Colors.ENDC}")
    print_slow(f"{Colors.HEADER}================{Colors.ENDC}")
    print_slow(f"Total Requests:       {len(requests)}")
    print_slow(f"Time WITHOUT Cache:   {time_without_cache:.2f}s")
    print_slow(f"Time WITH Cache:      {Colors.BOLD}{time_with_cache:.2f}s{Colors.ENDC}")
    print_slow(f"--------------------")
    print_slow(f"⏱️  TIME SAVED:        {Colors.GREEN}{saved_seconds:.2f} seconds{Colors.ENDC}")
    print_slow(f"📉 LATENCY REDUCTION: {Colors.GREEN}{percentage_saved:.1f}%{Colors.ENDC}")
    print_slow(f"🚀 SPEEDUP FACTOR:    {Colors.GREEN}{speedup_factor:.1f}x Faster{Colors.ENDC}")
    print_slow(f"{Colors.HEADER}================{Colors.ENDC}\n")

if __name__ == "__main__":
    asyncio.run(main())