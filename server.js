const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require("openai");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

require('dotenv').config()

const app = express();
const port = process.env.PORT || 1994;
app.use(express.json());
app.use(bodyParser.json());

const OPENAI_SECRET_KEY = process.env.OPENAI_SECRET_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_SECRET_KEY,
});

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);


const getChat = async (convId) => {
  const command = new GetCommand({
    TableName: "ttchat",
    Key: {
      convId: convId,
    },
  });

  const response = await docClient.send(command);
  return response;
}

const createChat = async (convId, convo) => {
  const command = new PutCommand({
    TableName: "ttchat",
    Item: {
      convId: convId,
      chat: convo,
    },
  });

  const response = await docClient.send(command);
  return response;
}

const updateChat = async (convId, convo) => {

  const command = new UpdateCommand({
    TableName: "ttchat",
    Key: {
      convId: convId
    },
    UpdateExpression: "set chat = :chat",
    ExpressionAttributeValues: {
      ":chat": convo,
    },
    ReturnValues: "ALL_NEW",
  });

  const response = await docClient.send(command);

  return response;
}

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;

  console.log({ apiKey, validApiKey })

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Unauthorized: API key is invalid or missing' });
  }

  next();
};

app.use(apiKeyMiddleware);

app.post('/rate', async (req, res) => {
  const { text } = req.body;

  const RATE_PROMPT = `You will be given a text the user has said in Japanese.
  Let them know if their sentence is gramatically correct or not and
  whether it makes sense or not. If something is wrong, correct the sentence.
  Keep it consise and factual only. do not ask any questions and do not ask for
  further input.`;

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        "role": "system",
        "content": RATE_PROMPT
      },
      {
        "role": "user",
        "content": text,
      },
    ],
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });


  const resp = response?.choices?.[0]?.message?.content?.trim();

  res.json({
    prompt: text,
    reply: resp || ''
  });
});

app.post('/chat', async (req, res) => {
  const { text, convId } = req.body;

  const STARTING_PROMPT = `Imagine you are a friendly chatbot acting as a
  companion for language learning.  You engage in conversations in simple
  Japanese, helping beginners to practice. As a friend, you're keen on
  discussing the user's daily life, hobbies, and celebrating their progress in
  learning Japanese.  If you are asked a personal question, you can make up an
  answer.  Your responses should be straightforward and in easy-to-understand
  Japanese, aiming to keep the conversation lively and engaging.  Try to say 1-2
  sentences only if possible.  Always try to maintain the dialogue by showing
  interest in their experiences, or suggesting light topics. You can also ask followups related to what users say.
  You can ask any friendly question to the user.`;

  const SYSTEM_MESSAGE = {
    "role": "system",
    "content": STARTING_PROMPT
  }

  const convoFromDb = await getChat(convId);

  /** @type Array*/
  let existingConversation = convoFromDb?.Item?.chat;


  if (!existingConversation) {
    existingConversation = [
      SYSTEM_MESSAGE,
    ];

    await createChat(convId, existingConversation);
  }
  existingConversation.push({
    "role": "user",
    "content": text
  })

  console.log({ existingConversation: JSON.stringify(existingConversation) })

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: existingConversation,
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const chatGPTResponse = response?.choices?.[0]?.message?.content?.trim();

  if (chatGPTResponse) {
    existingConversation.push({
      "role": "assistant",
      "content": chatGPTResponse,
    })
  }

  await updateChat(convId, existingConversation);

  res.json({ prompt: text, reply: chatGPTResponse || 'something went wrong' });
});

app.post('/clear', async (req, res) => {
  const { convId } = req.body;

  await updateChat(convId, null);

  res.json({ convId, });
});

app.post('/explain', async (req, res) => {
  const { text } = req.body;

  const EXPLAIN_PROMPT = `You are here to help new learners of Japanese. You
  will be given sentences in japanese. When given sentences, you will provide
  back a JSON of this format:

  {
    "reading": This will contain the sentence but with kanji replaced with kana reading,
    "romaji": This will contain the sentence but with romaji only,
    "translation": English translation
  }

  You provide JSON only. You do not give or receive any other prompt.`;

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        "role": "system",
        "content": EXPLAIN_PROMPT
      },
      {
        "role": "user",
        "content": text,
      },
    ],
    temperature: 1,
    max_tokens: 512,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });


  const resp = response?.choices?.[0]?.message?.content?.trim();

  let parsed = {};

  try {
    parsed = JSON.parse(resp);
  } catch (e) {
    console.error(e);
  }

  res.json({
    prompt: text,
    reply: {
      reading: parsed.reading,
      romaji: parsed.romaji,
      translation: parsed.translation,
    }
  });
});

app.listen(port, () => {
  if (!OPENAI_SECRET_KEY) {
    throw new Exception("OPENAI_SECRET_KEY Required");
  }
  console.log(`Server running on port ${port}`);
});

