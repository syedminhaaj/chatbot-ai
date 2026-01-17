const API_URL = "http://localhost:3000/chat"; // change after deploy
const history = [];

function toggleChat() {
  const box = document.getElementById("chat-box");
  box.style.display = box.style.display === "flex" ? "none" : "flex";
}

function addMessage(text, cls) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  document.getElementById("chat-messages").appendChild(div);
  div.scrollIntoView({ behavior: "smooth" });
}
function handleKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
}
async function sendMessage() {
  const input = document.getElementById("chat-text");
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, "user");
  input.value = "";

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();
  addMessage(data.reply, "bot");
}
