import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { VoicePipelineService } from '../voice-pipeline/voice-pipeline.service';
import { FieldDataService } from '../field-data/field-data.service';
import { BotIdentityService } from '../identity/bot-identity.service';

export interface PlaygroundMessageInput {
  message?: string;
  phoneNumber?: string;
  preferredLanguage?: 'en' | 'sw';
  memberName?: string;
  autoProvision?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  imageFilename?: string;
}

@ApiTags('Bot Playground')
@Controller('bot/playground')
export class BotPlaygroundController {
  private readonly logger = new Logger(BotPlaygroundController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly voicePipeline: VoicePipelineService,
    private readonly fieldData: FieldDataService,
    private readonly identity: BotIdentityService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Interactive Dr. Papi WhatsApp Bot Chat Playground' })
  getPlayground(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.renderPlaygroundHtml());
  }

  @Get('members')
  @ApiOperation({ summary: 'List available members for testing in the playground' })
  async getTestMembers() {
    try {
      const members = await this.prisma.member.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          preferredLanguage: true,
          isVerified: true,
        },
      });
      return members;
    } catch {
      return [];
    }
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message or image to Dr. Papi in the playground' })
  async sendMessage(@Body() input: PlaygroundMessageInput) {
    const rawPhone = (input.phoneNumber || '+254711000001').trim();
    const phoneDigits = rawPhone.replace(/[^\d]/g, '');
    const e164 = rawPhone.startsWith('+') ? rawPhone : `+${phoneDigits}`;

    // Auto-provision or verify member for smooth testing if requested
    let member = await this.identity.resolveMember({
      phoneDigitsFallback: phoneDigits,
      whatsappId: phoneDigits,
    });

    if (!member && input.autoProvision) {
      try {
        const name = input.memberName || 'Jane Wanjiku';
        member = await this.prisma.member.create({
          data: {
            phoneNumber: e164,
            fullName: name,
            preferredLanguage: input.preferredLanguage || 'en',
            isVerified: true,
          },
        });
      } catch (e) {
        this.logger.warn(`Could not auto-provision test member: ${e}`);
      }
    }

    // Handle Image upload if provided
    if (input.imageBase64) {
      const buffer = Buffer.from(input.imageBase64, 'base64');
      const mimeType = input.imageMimeType || 'image/jpeg';
      const result = await this.fieldData.ingestMedia({
        phoneCandidates: [phoneDigits, e164],
        memberId: member?.id,
        kind: 'IMAGE',
        mimeType,
        buffer,
        caption: input.message || null,
        originalFilename: input.imageFilename || 'playground-upload.jpg',
      });
      return {
        reply: result.reply,
        isImage: true,
        accepted: result.accepted,
        intent: 'FIELD_IMAGE_ANALYSIS',
        confidence: 0.98,
        member: member ? { name: member.fullName, phone: member.phoneNumber } : null,
      };
    }

    // Handle Text conversation turn
    const messageText = (input.message || '').trim();
    if (!messageText) {
      return { reply: 'Please provide a message or attach an image.', intent: 'NONE', confidence: 0 };
    }

    const result = await this.voicePipeline.processTextPipeline(
      messageText,
      phoneDigits,
      undefined,
      input.preferredLanguage,
      phoneDigits,
    );

    return {
      reply: result.patientMessage,
      intent: result.intent,
      confidence: result.intentConfidence,
      sessionUuid: result.intakeUuid,
      clinicalIntake: result.clinicalIntake || null,
      detectedLanguage: result.detectedLanguage,
      status: result.status,
      member: member ? { name: member.fullName, phone: member.phoneNumber } : null,
    };
  }

  private renderPlaygroundHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dr. Papi WhatsApp Bot — Chat Playground</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --panel-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #059669;
      --primary-hover: #10b981;
      --wa-chat-bg: #0b141a;
      --wa-bubble-in: #202c33;
      --wa-bubble-out: #005c4b;
      --wa-bubble-text: #e9edef;
      --wa-time-text: #8696a0;
      --badge-bg: #064e3b;
      --badge-text: #6ee7b7;
      --accent: #0284c7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    header {
      background: var(--panel);
      border-bottom: 1px solid var(--panel-border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .brand { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      width: 40px; height: 40px; border-radius: 12px;
      background: linear-gradient(135deg, #10b981, #0284c7);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: bold; color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .brand h1 { font-size: 17px; font-weight: 700; }
    .brand p { font-size: 12px; color: var(--text-muted); }

    .header-tags { display: flex; gap: 8px; align-items: center; }
    .pill {
      font-size: 11px; font-weight: 600; padding: 4px 10px;
      border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .pill-green { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
    .pill-blue { background: #0c4a6e; color: #7dd3fc; border: 1px solid #0284c7; }

    .main-container {
      display: flex;
      flex: 1;
      height: calc(100vh - 65px);
      overflow: hidden;
    }

    /* Left Sidebar: Settings & Personas */
    .sidebar-left {
      width: 320px;
      background: var(--panel);
      border-right: 1px solid var(--panel-border);
      display: flex;
      flex-direction: column;
      padding: 20px;
      gap: 16px;
      overflow-y: auto;
    }

    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: var(--text-muted); margin-bottom: 8px;
    }

    .field-group { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 12px; font-weight: 600; color: #cbd5e1; }
    select, input[type="text"] {
      background: #0f172a; border: 1px solid var(--panel-border);
      color: white; padding: 10px 12px; border-radius: 8px; font-size: 13px;
      outline: none; transition: border-color 0.2s;
    }
    select:focus, input[type="text"]:focus { border-color: var(--primary); }

    .quick-prompts { display: flex; flex-direction: column; gap: 8px; }
    .prompt-chip {
      background: #0f172a; border: 1px solid var(--panel-border);
      padding: 10px 12px; border-radius: 8px; font-size: 12px; color: #cbd5e1;
      cursor: pointer; transition: all 0.2s; text-align: left; line-height: 1.4;
    }
    .prompt-chip:hover {
      background: #1e293b; border-color: var(--primary); color: white;
      transform: translateY(-1px);
    }

    /* Center: Chat Window */
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--wa-chat-bg);
      position: relative;
    }

    .chat-header {
      background: #202c33;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .avatar {
      width: 42px; height: 42px; border-radius: 50%;
      background: #00a884; display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: white;
    }
    .chat-header-info h3 { font-size: 15px; font-weight: 600; color: #e9edef; }
    .chat-header-info p { font-size: 12px; color: #00a884; }

    .chat-messages {
      flex: 1;
      padding: 20px 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .msg-row { display: flex; width: 100%; }
    .msg-row.out { justify-content: flex-end; }
    .msg-row.in { justify-content: flex-start; }

    .msg-bubble {
      max-width: 70%;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13.5px;
      line-height: 1.5;
      position: relative;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .msg-bubble.out {
      background: var(--wa-bubble-out);
      color: var(--wa-bubble-text);
      border-top-right-radius: 2px;
    }

    .msg-bubble.in {
      background: var(--wa-bubble-in);
      color: var(--wa-bubble-text);
      border-top-left-radius: 2px;
    }

    .msg-time {
      font-size: 10px;
      color: var(--wa-time-text);
      text-align: right;
      margin-top: 4px;
    }

    .image-preview-card {
      max-width: 240px;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .image-preview-card img {
      width: 100%;
      display: block;
    }

    .typing-indicator {
      display: none;
      align-items: center;
      gap: 5px;
      background: var(--wa-bubble-in);
      padding: 10px 16px;
      border-radius: 12px;
      width: fit-content;
    }
    .typing-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #8696a0; animation: bounce 1.2s infinite ease-in-out;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    /* Bottom input area */
    .chat-input-bar {
      background: #202c33;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }

    .attach-btn {
      background: none; border: none; color: #8696a0; cursor: pointer;
      font-size: 20px; transition: color 0.2s; padding: 4px;
    }
    .attach-btn:hover { color: #e9edef; }

    .chat-input {
      flex: 1;
      background: #2a3942;
      border: none;
      outline: none;
      color: #e9edef;
      padding: 11px 16px;
      border-radius: 8px;
      font-size: 14px;
    }

    .send-btn {
      background: #00a884;
      border: none;
      border-radius: 50%;
      width: 42px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .send-btn:hover { background: #06cf9c; }

    /* Right Sidebar: Diagnostics Inspector */
    .sidebar-right {
      width: 330px;
      background: var(--panel);
      border-left: 1px solid var(--panel-border);
      display: flex;
      flex-direction: column;
      padding: 20px;
      gap: 16px;
      overflow-y: auto;
    }

    .diag-card {
      background: #0f172a;
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .diag-item { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    .diag-label { color: var(--text-muted); font-weight: 500; }
    .diag-val { font-weight: 700; color: #e2e8f0; }

    .json-box {
      background: #090d16;
      border: 1px solid #1e293b;
      padding: 10px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 11px;
      color: #38bdf8;
      max-height: 220px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .selected-image-badge {
      display: none;
      align-items: center;
      gap: 8px;
      background: #1e293b;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: #38bdf8;
      border: 1px solid #0284c7;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo-badge">🦷</div>
      <div>
        <h1>Dr. Papi — Interactive WhatsApp Playground</h1>
        <p>Gemini LLM · Multimodal Vision · Real Slot Availability · Kenya Oral Health</p>
      </div>
    </div>
    <div class="header-tags">
      <span class="pill pill-green">Gemini Live</span>
      <span class="pill pill-blue">v2 Engine</span>
    </div>
  </header>

  <div class="main-container">
    <!-- Left Configuration Sidebar -->
    <div class="sidebar-left">
      <div class="section-title">Test Persona & Sender</div>

      <div class="field-group">
        <label class="field-label">Sender Preset</label>
        <select id="memberPreset" onchange="onMemberPresetChange()">
          <option value="+254711000001|Jane Wanjiku|en">Jane Wanjiku (+254711000001) [EN]</option>
          <option value="+254711000002|Juma Bakari|sw">Juma Bakari (+254711000002) [SW]</option>
          <option value="+254711000003|David Omondi|en">David Omondi (+254711000003) [Emergency EN]</option>
          <option value="+254711000004|Fatuma Ali|sw">Fatuma Ali (+254711000004) [Emergency SW]</option>
          <option value="+254711999999|Zxqvelo Mbugua|en">Zxqvelo Mbugua [Canary Name Check]</option>
          <option value="+254700000000|Stranger|en">Unmatched Stranger (+254700000000)</option>
        </select>
      </div>

      <div class="field-group">
        <label class="field-label">Phone Number</label>
        <input type="text" id="phoneInput" value="+254711000001">
      </div>

      <div class="field-group">
        <label class="field-label">Preferred Language</label>
        <select id="langInput">
          <option value="en">English (en)</option>
          <option value="sw">Kiswahili (sw)</option>
        </select>
      </div>

      <div class="section-title" style="margin-top: 10px;">Quick Test Scenarios</div>
      <div class="quick-prompts">
        <button class="prompt-chip" onclick="setQuickPrompt('Hello MenoAI, I would like help accessing dental care.')">
          <strong>Turn 1:</strong> Accessing dental care
        </button>
        <button class="prompt-chip" onclick="setQuickPrompt('I had some sensitivity while drinking cold water.')">
          <strong>Turn 2:</strong> Cold water tooth sensitivity
        </button>
        <button class="prompt-chip" onclick="setQuickPrompt('Habari, jino linaniuma sana tangu jana nikinywa maji baridi.')">
          <strong>Swahili:</strong> Maumivu ya meno (Toothache)
        </button>
        <button class="prompt-chip" onclick="setQuickPrompt('What slots are free in Nyali this Thursday?')">
          <strong>Booking:</strong> Check real clinic slots
        </button>
        <button class="prompt-chip" onclick="setQuickPrompt('I had an accident, my tooth is broken and bleeding heavily, my face is swollen and I cannot swallow!')">
          <strong>Emergency:</strong> Dental trauma & red flags
        </button>
        <button class="prompt-chip" onclick="setQuickPrompt('How much does a routine cleaning cost?')">
          <strong>Pricing:</strong> MenoDAO tier benefits
        </button>
      </div>
    </div>

    <!-- Center: Chat Surface -->
    <div class="chat-container">
      <div class="chat-header">
        <div class="avatar">👨‍⚕️</div>
        <div class="chat-header-info">
          <h3>Dr. Papi (MenoAI)</h3>
          <p>Online · Powered by Gemini</p>
        </div>
      </div>

      <div class="chat-messages" id="messagesList">
        <div class="msg-row in">
          <div class="msg-bubble in">
            Karibu! I am <strong>MenoAI</strong>, your conversational dental health assistant for the Dr. Papi Foundation. How can I assist you with your smile today?
            <div class="msg-time">Just now</div>
          </div>
        </div>
      </div>

      <div class="typing-indicator" id="typingIndicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>

      <div class="chat-input-bar">
        <input type="file" id="filePicker" accept="image/*" style="display: none;" onchange="handleImageSelected(event)">
        <button class="attach-btn" title="Attach dental photo or document image" onclick="document.getElementById('filePicker').click()">📎</button>

        <div style="flex: 1; display: flex; flex-direction: column;">
          <div id="imageSelectedBadge" class="selected-image-badge">
            <span id="imageFileName">image.jpg</span>
            <button style="background: none; border: none; color: #ef4444; cursor: pointer;" onclick="clearSelectedImage()">✕</button>
          </div>
          <input type="text" class="chat-input" id="messageInput" placeholder="Type a message or dental question..." onkeydown="handleKeyDown(event)">
        </div>

        <button class="send-btn" id="sendBtn" onclick="sendUserMessage()">➤</button>
      </div>
    </div>

    <!-- Right: Real-time Diagnostics Inspector -->
    <div class="sidebar-right">
      <div class="section-title">Turn Diagnostics & AI Inspector</div>

      <div class="diag-card">
        <div class="diag-item">
          <span class="diag-label">Classified Intent</span>
          <span class="diag-val" id="diagIntent">—</span>
        </div>
        <div class="diag-item">
          <span class="diag-label">Confidence</span>
          <span class="diag-val" id="diagConfidence">—</span>
        </div>
        <div class="diag-item">
          <span class="diag-label">Language</span>
          <span class="diag-val" id="diagLanguage">—</span>
        </div>
        <div class="diag-item">
          <span class="diag-label">Session UUID</span>
          <span class="diag-val" id="diagSession" style="font-size: 10px;">—</span>
        </div>
      </div>

      <div class="section-title">Clinical Extraction & Metadata</div>
      <div class="json-box" id="diagJson">Awaiting first message...</div>
    </div>
  </div>

  <script>
    let currentImageBase64 = null;
    let currentImageMimeType = null;
    let currentImageFilename = null;

    function onMemberPresetChange() {
      const preset = document.getElementById('memberPreset').value;
      const [phone, name, lang] = preset.split('|');
      document.getElementById('phoneInput').value = phone;
      document.getElementById('langInput').value = lang;
    }

    function setQuickPrompt(text) {
      document.getElementById('messageInput').value = text;
      document.getElementById('messageInput').focus();
    }

    function handleKeyDown(e) {
      if (e.key === 'Enter') {
        sendUserMessage();
      }
    }

    function handleImageSelected(event) {
      const file = event.target.files[0];
      if (!file) return;

      currentImageFilename = file.name;
      currentImageMimeType = file.type || 'image/jpeg';

      const reader = new FileReader();
      reader.onload = function(e) {
        const fullDataUrl = e.target.result;
        currentImageBase64 = fullDataUrl.split(',')[1];
        document.getElementById('imageFileName').textContent = '📷 ' + file.name;
        document.getElementById('imageSelectedBadge').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    }

    function clearSelectedImage() {
      currentImageBase64 = null;
      currentImageMimeType = null;
      currentImageFilename = null;
      document.getElementById('filePicker').value = '';
      document.getElementById('imageSelectedBadge').style.display = 'none';
    }

    function appendMessage(text, isOut, imageSrc = null) {
      const list = document.getElementById('messagesList');
      const row = document.createElement('div');
      row.className = 'msg-row ' + (isOut ? 'out' : 'in');

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble ' + (isOut ? 'out' : 'in');

      if (imageSrc) {
        const card = document.createElement('div');
        card.className = 'image-preview-card';
        const img = document.createElement('img');
        img.src = imageSrc;
        card.appendChild(img);
        bubble.appendChild(card);
      }

      const textNode = document.createElement('div');
      textNode.textContent = text;
      bubble.appendChild(textNode);

      const time = document.createElement('div');
      time.className = 'msg-time';
      const now = new Date();
      time.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      bubble.appendChild(time);

      row.appendChild(bubble);
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
    }

    async function sendUserMessage() {
      const input = document.getElementById('messageInput');
      const text = input.value.trim();
      const imageBase64 = currentImageBase64;
      const imageMime = currentImageMimeType;
      const imageFilename = currentImageFilename;

      if (!text && !imageBase64) return;

      const imagePreviewUrl = imageBase64 ? 'data:' + imageMime + ';base64,' + imageBase64 : null;
      appendMessage(text, true, imagePreviewUrl);

      input.value = '';
      clearSelectedImage();

      const typing = document.getElementById('typingIndicator');
      typing.style.display = 'flex';
      const list = document.getElementById('messagesList');
      list.scrollTop = list.scrollHeight;

      const phone = document.getElementById('phoneInput').value.trim();
      const lang = document.getElementById('langInput').value;

      try {
        const res = await fetch('/bot/playground/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            phoneNumber: phone,
            preferredLanguage: lang,
            autoProvision: true,
            imageBase64: imageBase64,
            imageMimeType: imageMime,
            imageFilename: imageFilename
          })
        });

        const data = await res.json();
        typing.style.display = 'none';

        appendMessage(data.reply, false);

        // Update Diagnostics Inspector
        document.getElementById('diagIntent').textContent = data.intent || '—';
        document.getElementById('diagConfidence').textContent = data.confidence ? Math.round(data.confidence * 100) + '%' : '—';
        document.getElementById('diagLanguage').textContent = data.detectedLanguage || lang;
        document.getElementById('diagSession').textContent = data.sessionUuid ? data.sessionUuid.slice(0, 18) + '...' : '—';
        document.getElementById('diagJson').textContent = JSON.stringify({
          intent: data.intent,
          confidence: data.confidence,
          clinicalIntake: data.clinicalIntake,
          member: data.member,
          status: data.status
        }, null, 2);

      } catch (err) {
        typing.style.display = 'none';
        appendMessage('Error: Failed to reach bot backend (' + err.message + ')', false);
      }
    }
  </script>
</body>
</html>`;
  }
}
