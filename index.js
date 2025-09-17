const { BskyAgent } = require('@atproto/api');
const fs = require('fs').promises;
const path = require('path');

class UniversityPressSalesBot {
  constructor(config) {
    this.agent = new BskyAgent({ service: 'https://bsky.social' });
    this.config = config;
    this.processedPosts = new Set();
    this.universityPresses = new Map();
  }

  async loadProcessedPosts() {
    try {
      const data = await fs.readFile(path.join(__dirname, 'data', 'processed_posts.json'), 'utf8');
      this.processedPosts = new Set(JSON.parse(data));
    } catch (error) {
      console.log('Starting fresh - no previous data found');
    }
  }

  async saveProcessedPosts() {
    try {
      await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
      await fs.writeFile(
        path.join(__dirname, 'data', 'processed_posts.json'), 
        JSON.stringify([...this.processedPosts])
      );
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  async authenticate() {
    await this.agent.login({
      identifier: this.config.bluesky.username,
      password: this.config.bluesky.password
    });
    console.log('Authenticated successfully');
  }

 async loadMonitoredAccounts() {
  console.log('Loading monitored accounts from list...');
  
  const response = await this.agent.app.bsky.graph.getList({
    list: this.config.universityPressListUri,
    limit: 100
  });
  
  this.universityPresses.clear();
  response.data.items.forEach(item => {
    this.universityPresses.set(item.subject.handle, {
      name: item.subject.displayName || item.subject.handle,
      handle: item.subject.handle
    });
  });
  
  console.log(`Monitoring ${this.universityPresses.size} accounts`);
}

  async checkForSalesPosts() {
    console.log('Checking for sales posts...');
    
    for (const [handle, account] of this.universityPresses) {
      try {
        const posts = await this.agent.getAuthorFeed({
          actor: account.handle,
          limit: 20
        });

        for (const feedItem of posts.data.feed) {
          const post = feedItem.post;
          
          if (this.processedPosts.has(post.uri)) continue;
          
          if (this.isSalesPost(post.record.text)) {
            console.log(`Found sales post from ${account.name}`);
            await this.agent.repost(post.uri, post.cid);
            this.processedPosts.add(post.uri);
          } else {
            // Still mark as processed to avoid checking again
            this.processedPosts.add(post.uri);
          }
        }
        
        // Small delay to be nice to the API
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error checking ${account.handle}:`, error);
      }
    }
    
    // Clean up old processed posts to prevent memory issues
    if (this.processedPosts.size > 10000) {
      const oldPosts = Array.from(this.processedPosts).slice(0, 5000);
      oldPosts.forEach(uri => this.processedPosts.delete(uri));
      console.log('Cleaned up old processed posts');
    }
    
    await this.saveProcessedPosts();
  }

  isSalesPost(text) {
    const lowerText = text.toLowerCase();
    return this.config.salesKeywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
  }

  // Modified for GitHub Actions - single run instead of continuous
  async run() {
    try {
      await this.loadProcessedPosts();
      await this.authenticate();
      await this.loadMonitoredAccounts();
      await this.checkForSalesPosts();
      
      console.log('Bot run completed successfully');
    } catch (error) {
      console.error('Bot run failed:', error);
      process.exit(1);
    }
  }
}

// Configuration loaded from environment variables
const config = {
  bluesky: {
    username: process.env.BLUESKY_USERNAME,
    password: process.env.BLUESKY_PASSWORD
  },
  salesKeywords: process.env.SALES_KEYWORDS ? 
    process.env.SALES_KEYWORDS.split(',').map(k => k.trim()) : 
    ['sale', 'discount', 'offer', 'special', 'promotion', 'deal']
  universityPressListUri: process.env.UNIVERSITY_PRESS_LIST_URI
};

// Validate configuration
if (!config.bluesky.username || !config.bluesky.password) {
  console.error('Missing required environment variables: BLUESKY_USERNAME, BLUESKY_PASSWORD');
  process.exit(1);
}

// Run the bot
const bot = new UniversityPressSalesBot(config);
bot.run();
