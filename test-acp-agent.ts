#!/usr/bin/env bun
/**
 * ACP Test Agent - Speaks full ACP protocol
 * 
 * This agent receives ACP task messages via stdin and responds
 * with ACP-compliant messages via stdout.
 */

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendProgress(taskId: string, percent: number, message: string, stage?: string) {
  const msg = {
    protocol: 'acp/1.0',
    type: 'progress',
    taskId,
    timestamp: Date.now(),
    payload: { percent, message, stage }
  };
  console.log(JSON.stringify(msg));
}

function sendResponse(taskId: string, message: string, artifacts?: any[], mentions?: string[]) {
  const msg = {
    protocol: 'acp/1.0',
    type: 'response',
    taskId,
    timestamp: Date.now(),
    payload: {
      status: 'completed',
      message,
      artifacts: artifacts || [],
      mentions: mentions || []
    }
  };
  console.log(JSON.stringify(msg));
}

function sendError(taskId: string, code: string, message: string) {
  const msg = {
    protocol: 'acp/1.0',
    type: 'error',
    taskId,
    timestamp: Date.now(),
    payload: { code, message, recoverable: false }
  };
  console.log(JSON.stringify(msg));
}

// Process ACP task from environment or stdin
async function processTask() {
  // Check environment variables first
  const mentionId = process.env.MENTION_ID;
  const content = process.env.MENTION_CONTENT || '';
  const taskId = mentionId || process.env.TASK_ID || 'unknown';
  
  // Send initial progress
  sendProgress(taskId, 10, 'Starting ACP test agent...', 'init');
  
  // Parse content for commands
  const isTestMode = content.includes('--test-acp') || content.includes('test');
  
  // Simulate some work
  await new Promise(r => setTimeout(r, 500));
  sendProgress(taskId, 30, 'Parsing task...', 'parse');
  
  await new Promise(r => setTimeout(r, 500));
  sendProgress(taskId, 50, 'Processing request...', 'process');
  
  // Generate response based on content
  let responseMessage = 'ACP protocol test completed successfully!';
  let artifacts: any[] = [];
  let mentions: string[] = [];
  
  if (isTestMode) {
    responseMessage = `✅ ACP Protocol Test Passed!\n\n` +
      `- Protocol: acp/1.0\n` +
      `- Task ID: ${taskId}\n` +
      `- Environment: ${process.env.NODE_ENV || 'development'}\n` +
      `- Timestamp: ${new Date().toISOString()}\n\n` +
      `The agent successfully received and processed the ACP task.`;
    
    artifacts = [
      {
        type: 'data',
        name: 'test-results.json',
        content: JSON.stringify({
          protocol: 'acp/1.0',
          taskId,
          status: 'passed',
          timestamp: Date.now(),
          environment: {
            MENTION_ID: mentionId,
            CHANNEL_ID: process.env.CHANNEL_ID,
            CHANNEL_NAME: process.env.CHANNEL_NAME
          }
        }, null, 2),
        mimeType: 'application/json'
      }
    ];
  } else {
    // Echo the content back
    responseMessage = `Received your message:\n\n${content}\n\n` +
      `This is a test ACP agent. Include "--test-acp" in your message for a detailed test report.`;
  }
  
  await new Promise(r => setTimeout(r, 500));
  sendProgress(taskId, 80, 'Generating response...', 'respond');
  
  await new Promise(r => setTimeout(r, 300));
  sendProgress(taskId, 100, 'Complete!', 'complete');
  
  // Send final response
  sendResponse(taskId, responseMessage, artifacts, mentions);
}

// Listen for ACP messages on stdin
rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line.trim());
    
    if (msg.protocol === 'acp/1.0') {
      if (msg.type === 'task') {
        // Process ACP task
        await processTask();
      } else if (msg.type === 'clarification_response') {
        // Handle clarification response
        sendResponse(msg.taskId, 'Received clarification response, continuing...');
      }
    }
  } catch (e) {
    // Not JSON, ignore (plain text)
    process.exit(0);
  }
});

// If no stdin input after a short wait, use environment
setTimeout(async () => {
  if (!rl.input.readable) {
    await processTask();
    process.exit(0);
  }
}, 100);

// Handle stdin close
rl.on('close', () => {
  process.exit(0);
});