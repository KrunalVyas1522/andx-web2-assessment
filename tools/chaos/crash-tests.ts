import { execSync } from 'child_process';

function runCrashTest() {
  console.log('⚡ Starting Chaos Crash Test...');

  setTimeout(() => {
    console.log('💥 Killing aggregator container (simulating OOM or Kernel panic)...');
    execSync('docker kill aggregator');
    
    setTimeout(() => {
      console.log('🚀 Restarting aggregator (simulating auto-recovery)...');
      execSync('docker start aggregator');
    }, 5000);
    
  }, 10000); // 10 seconds into the run

  setTimeout(() => {
    console.log('💥 Killing earnings container...');
    execSync('docker kill earnings');
    
    setTimeout(() => {
      console.log('🚀 Restarting earnings (catching up exactly on Outbox events)...');
      execSync('docker start earnings');
    }, 7000);
    
  }, 25000);
}

runCrashTest();
