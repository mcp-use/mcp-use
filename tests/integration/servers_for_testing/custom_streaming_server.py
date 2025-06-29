"""
Custom Streaming MCP Server with Long-running SSE Support

This creates a custom MCP server using FastMCP that demonstrates:
- Continuous data streaming via SSE
- Real-time notifications and updates
- Long-running operations with progress tracking
- Live data feeds and monitoring capabilities

Run this server first, then use it with the long_running_sse_example.py
"""

import asyncio
import json
import random
import time
from datetime import datetime
from typing import Any

from fastmcp import FastMCP

# Create FastMCP server instance
mcp = FastMCP(name="StreamingMCPServer")

# Active streams tracking
active_streams: dict[str, bool] = {}


@mcp.tool()
def start_monitoring() -> dict[str, Any]:
    """Start a long-running monitoring task"""
    task_id = f"monitor_{int(time.time())}"
    active_streams[task_id] = True
    return {"task_id": task_id, "status": "started"}


@mcp.tool()
def stop_monitoring(task_id: str) -> dict[str, Any]:
    """Stop a monitoring task"""
    if task_id in active_streams:
        active_streams[task_id] = False
        return {"task_id": task_id, "status": "stopped"}
    return {"error": "Task not found"}


@mcp.tool()
def get_current_metrics() -> dict[str, Any]:
    """Get current system metrics"""
    return {
        "timestamp": datetime.now().isoformat(),
        "cpu_percent": random.uniform(10, 90),
        "memory_percent": random.uniform(30, 80),
        "disk_io_read": random.randint(100, 1000),
        "disk_io_write": random.randint(50, 500),
        "network_in": random.randint(1000, 10000),
        "network_out": random.randint(500, 5000),
        "active_processes": random.randint(50, 200),
    }


@mcp.tool()
def get_system_status() -> dict[str, Any]:
    """Get current system status"""
    services = ["database", "redis", "auth_service", "payment_service", "notification_service"]
    status_update = {"timestamp": datetime.now().isoformat(), "services": {}}

    for service in services:
        # 95% chance of being healthy
        is_healthy = random.random() > 0.05
        status_update["services"][service] = {
            "status": "healthy" if is_healthy else "degraded",
            "response_time_ms": random.randint(10, 200),
            "last_check": datetime.now().isoformat(),
        }

    return status_update


@mcp.tool()
def get_latest_logs(count: int = 10) -> list[dict[str, Any]]:
    """Get the latest log entries"""
    log_levels = ["INFO", "DEBUG", "WARNING", "ERROR"]
    log_sources = ["auth", "database", "api", "scheduler", "worker"]

    logs = []
    for i in range(count):
        log_entry = {
            "id": i + 1,
            "timestamp": datetime.now().isoformat(),
            "level": random.choice(log_levels),
            "source": random.choice(log_sources),
            "message": f"Sample log message {i + 1} - Operation completed successfully",
            "details": {
                "user_id": random.randint(1000, 9999),
                "request_id": f"req_{random.randint(10000, 99999)}",
                "duration_ms": random.randint(10, 500),
            },
        }
        logs.append(log_entry)

    return logs


@mcp.resource("stream://metrics/current")
def metrics_resource() -> str:
    """Current metrics as a resource"""
    metrics = get_current_metrics()
    return json.dumps(metrics, indent=2)


@mcp.resource("stream://status/current")
def status_resource() -> str:
    """Current system status as a resource"""
    status = get_system_status()
    return json.dumps(status, indent=2)


@mcp.resource("stream://logs/recent")
def logs_resource() -> str:
    """Recent logs as a resource"""
    logs = get_latest_logs(20)
    return json.dumps(logs, indent=2)


@mcp.prompt()
def monitoring_prompt() -> str:
    """Generate a monitoring prompt with current system data"""
    metrics = get_current_metrics()
    status = get_system_status()

    return f"""Based on the current system metrics and status, please analyze the system health:

Current Metrics:
- CPU Usage: {metrics["cpu_percent"]:.1f}%
- Memory Usage: {metrics["memory_percent"]:.1f}%
- Network In: {metrics["network_in"]} KB/s
- Network Out: {metrics["network_out"]} KB/s
- Active Processes: {metrics["active_processes"]}

System Status:
{json.dumps(status["services"], indent=2)}

Please provide insights on:
1. Overall system health
2. Any potential issues or concerns
3. Recommended actions if needed
"""


@mcp.prompt()
def performance_analysis_prompt() -> str:
    """Generate a performance analysis prompt"""
    metrics = get_current_metrics()

    return f"""Analyze the current system performance metrics:

CPU: {metrics["cpu_percent"]:.1f}%
Memory: {metrics["memory_percent"]:.1f}%
Disk I/O Read: {metrics["disk_io_read"]} KB/s
Disk I/O Write: {metrics["disk_io_write"]} KB/s
Network In: {metrics["network_in"]} KB/s
Network Out: {metrics["network_out"]} KB/s

Please evaluate:
1. Current performance bottlenecks
2. Resource utilization patterns
3. Optimization recommendations
"""


# Background task for continuous monitoring (simulating streaming behavior)
async def background_monitoring():
    """Background task that simulates continuous monitoring"""
    while True:
        # Update metrics and status periodically
        current_time = datetime.now().isoformat()

        # Simulate notifications for high resource usage
        metrics = get_current_metrics()
        if metrics["cpu_percent"] > 80:
            print(f"[{current_time}] ALERT: High CPU usage detected: {metrics['cpu_percent']:.1f}%")

        if metrics["memory_percent"] > 75:
            print(f"[{current_time}] ALERT: High memory usage detected: {metrics['memory_percent']:.1f}%")

        # Check for degraded services
        status = get_system_status()
        for service, details in status["services"].items():
            if details["status"] == "degraded":
                print(f"[{current_time}] ALERT: Service {service} is degraded")

        await asyncio.sleep(10)  # Check every 10 seconds


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request) -> dict:
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@mcp.custom_route("/monitoring/active", methods=["GET"])
async def get_active_monitoring(request) -> dict:
    """Get currently active monitoring tasks"""
    active_tasks = {k: v for k, v in active_streams.items() if v}
    return {"active_tasks": active_tasks, "total_count": len(active_tasks)}


if __name__ == "__main__":
    print("🚀 Starting Custom Streaming MCP Server using FastMCP...")
    print("📡 Server features:")
    print("   - Real-time monitoring tools")
    print("   - System metrics and status")
    print("   - Log streaming capabilities")
    print("   - Performance analysis prompts")
    print("   - Background monitoring alerts")
    print("\n💡 Available endpoints:")
    print("   - SSE endpoint: http://localhost:8080/sse")
    print("   - Health check: http://localhost:8080/health")
    print("   - Active monitoring: http://localhost:8080/monitoring/active")
    print("\n💡 Use this server with long_running_sse_example.py")
    print("⚡ Starting server...")

    # Run the FastMCP server with SSE transport
    mcp.run(transport="sse", host="0.0.0.0", port=8080, log_level="info")
