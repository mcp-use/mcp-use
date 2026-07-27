use rmcp::{
    handler::server::wrapper::Parameters,
    tool, tool_router,
    transport::streamable_http_server::{
        session::never::NeverSessionManager, StreamableHttpServerConfig,
        StreamableHttpService,
    },
};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct EchoRequest {
    message: String,
}

#[derive(Debug, Clone)]
struct EchoServer;

#[tool_router(server_handler)]
impl EchoServer {
    #[tool(
        name = "benchmark_echo",
        description = "Return the supplied message."
    )]
    fn benchmark_echo(
        &self,
        Parameters(EchoRequest { message }): Parameters<EchoRequest>,
    ) -> String {
        message
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(43100);
    let cancellation = tokio_util::sync::CancellationToken::new();
    let mut config = StreamableHttpServerConfig::default()
        .with_cancellation_token(cancellation.child_token())
        .disable_allowed_hosts();
    config.stateful_mode = false;
    config.json_response = true;
    let service = StreamableHttpService::new(
        || Ok(EchoServer),
        NeverSessionManager::default().into(),
        config,
    );
    let app = axum::Router::new().nest_service("/mcp", service);
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        port,
    ))
    .await?;
    println!("ready:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::signal::ctrl_c().await.ok();
            cancellation.cancel();
        })
        .await?;
    Ok(())
}
