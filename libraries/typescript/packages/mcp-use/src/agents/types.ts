import type {
  AIMessage,
  HumanMessage,
  ToolMessage,
  SystemMessage,
} from "langchain";

export type BaseMessage =
  | AIMessage
  | HumanMessage
  | ToolMessage
  | SystemMessage;
