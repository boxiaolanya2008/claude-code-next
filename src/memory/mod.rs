//! Memory Module - Session and memory management

use std::path::PathBuf;
use chrono::{DateTime, Utc};

/// Memory Manager
pub struct MemoryManager;

impl MemoryManager {
    /// Get memory status
    pub fn status() -> anyhow::Result<MemoryStatus> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let memory_path = home.join(".claude-code").join("memory.json");
        
        if memory_path.exists() {
            let content = std::fs::read_to_string(&memory_path)?;
            let memories: Vec<MemoryEntry> = serde_json::from_str(&content)?;
            Ok(MemoryStatus {
                session_count: memories.iter().filter(|m| m.memory_type == "session").count(),
                memory_count: memories.len(),
                last_consolidation: None, // TODO: Track consolidation
            })
        } else {
            Ok(MemoryStatus {
                session_count: 0,
                memory_count: 0,
                last_consolidation: None,
            })
        }
    }
    
    /// Clear all memories
    pub fn clear() -> anyhow::Result<()> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let memory_path = home.join(".claude-code").join("memory.json");
        
        if memory_path.exists() {
            std::fs::remove_file(&memory_path)?;
        }
        
        Ok(())
    }
    
    /// Export memories to a file
    pub fn export(output: &PathBuf) -> anyhow::Result<()> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let memory_path = home.join(".claude-code").join("memory.json");
        
        if memory_path.exists() {
            std::fs::copy(&memory_path, output)?;
        } else {
            std::fs::write(output, "[]")?;
        }
        
        Ok(())
    }
    
    /// Import memories from a file
    pub fn import(input: &PathBuf) -> anyhow::Result<()> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let memory_dir = home.join(".claude-code");
        std::fs::create_dir_all(&memory_dir)?;
        
        let memory_path = memory_dir.join("memory.json");
        std::fs::copy(input, &memory_path)?;
        
        Ok(())
    }
    
    /// Run memory consolidation (dream)
    pub fn dream() -> anyhow::Result<()> {
        // TODO: Implement actual consolidation logic
        println!("Analyzing and consolidating memories...");
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct MemoryStatus {
    pub session_count: usize,
    pub memory_count: usize,
    pub last_consolidation: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub memory_type: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub metadata: std::collections::HashMap<String, serde_json::Value>,
}