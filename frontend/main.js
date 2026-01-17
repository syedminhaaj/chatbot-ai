    //const API_URL = "http://localhost:3000/chat";
    const API_URL = "https://bookish-fortnight-7r49qv556jg2x4v-3000.app.github.dev/chat";
      const sessionId = Math.random().toString(36).substring(7);

      function toggleChat() {
        const box = document.getElementById("chat-box");
        box.classList.toggle("open");
        
        if (box.classList.contains("open")) {
          document.getElementById("chat-text").focus();
          
          // Welcome message on first open
          const messages = document.getElementById("chat-messages");
          if (messages.children.length === 0) {
            addBotMessage("👋 Hello! I'm your driving school assistant.\n\nI can help you with:\n• Booking driving lessons\n• Answering questions about our courses\n• Finding instructor availability\n\nHow can I help you today?");
          }
        }
      }

      function handleKey(event) {
        if (event.key === "Enter") {
          sendMessage();
        }
      }

      async function sendMessage() {
        const input = document.getElementById("chat-text");
        const text = input.value.trim();

        if (!text) return;

        // Add user message
        addUserMessage(text);
        input.value = "";

        // Disable input while processing
        const sendBtn = document.getElementById("send-btn");
        sendBtn.disabled = true;
        input.disabled = true;

        // Show typing indicator
        const typingId = showTyping();

        try {
          const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              message: text,
              sessionId: sessionId 
            }),
          });

          const data = await response.json();
          
          // Remove typing indicator
          removeTyping(typingId);
          
          // Add bot response
          addBotMessage(data.reply || "Sorry, I didn't understand that.");
        } catch (error) {
          console.error("Error:", error);
          removeTyping(typingId);
          addBotMessage("Sorry, I'm having trouble connecting. Please try again.");
        } finally {
          // Re-enable input
          sendBtn.disabled = false;
          input.disabled = false;
          input.focus();
        }
      }

      function addUserMessage(text) {
        const msg = document.createElement("div");
        msg.className = "msg user";
        msg.textContent = text;
        
        const container = document.getElementById("chat-messages");
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
      }

      function addBotMessage(text) {
        const msg = document.createElement("div");
        msg.className = "msg bot";
        msg.textContent = text;
        
        const container = document.getElementById("chat-messages");
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
      }

      function showTyping() {
        const typing = document.createElement("div");
        const id = "typing-" + Date.now();
        typing.id = id;
        typing.className = "typing";
        typing.innerHTML = "<span></span><span></span><span></span>";
        
        const container = document.getElementById("chat-messages");
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
        
        return id;
      }

      function removeTyping(id) {
        const typing = document.getElementById(id);
        if (typing) {
          typing.remove();
        }
      }