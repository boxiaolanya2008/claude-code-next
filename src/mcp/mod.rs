//! MCP (Model Context Protocol) Module

use crate::config::{McpConfig, McpServerStatus};
use std::collections::HashMap;

/// MCP Server Manager
#[allow(dead_code)]
pub struct McpManager {
    servers: HashMap<String, McpServerConnection>,
}

#[allow(dead_code)]
struct McpServerConnection {
    config: McpConfig,
    process: Option<tokio::process::Child>,
}

impl McpManager {
    /// List all configured MCP servers
    pub fn list_servers() -> anyhow::Result<Vec<McpServerInfo>> {
        let settings = crate::config::Settings::load()?;
        Ok(settings.mcp_servers.iter().map(|s| McpServerInfo {
            name: s.name.clone(),
            status: s.status.clone(),
        }).collect())
    }
    
    /// Add a new MCP server
    pub fn add_server(name: &str, command: &str) -> anyhow::Result<()> {
        let mut settings = crate::config::Settings::load()?;
        let config = McpConfig::new(name, command);
        settings.mcp_servers.push(config);
        settings.save()?;
        Ok(())
    }
    
    /// Remove an MCP server
    pub fn remove_server(name: &str) -> anyhow::Result<()> {
        let mut settings = crate::config::Settings::load()?;
        settings.mcp_servers.retain(|s| s.name != name);
        settings.save()?;
        Ok(())
    }
    
    /// Restart an MCP server
    pub fn restart_server(name: &str) -> anyhow::Result<()> {
        // TODO: Implement actual restart logic
        println!("Restarting MCP server: {}", name);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct McpServerInfo {
    pub name: String,
    pub status: McpServerStatus,
}