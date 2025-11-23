import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Check, X, Edit2, Eye } from "lucide-react";
import { JSONDisplay } from "../shared/JSONDisplay";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
  ErrorData,
} from "mcp-use";

interface SamplingRequest {
  id: string;
  params: CreateMessageRequestParams;
  timestamp: number;
  status: "pending" | "approved" | "rejected" | "completed";
  result?: CreateMessageResult | ErrorData;
  modifiedParams?: CreateMessageRequestParams;
}

interface SamplingRequestPanelProps {
  requests: SamplingRequest[];
  onApprove: (id: string, params: CreateMessageRequestParams) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, params: CreateMessageRequestParams) => void;
}

export function SamplingRequestPanel({
  requests,
  onApprove,
  onReject,
  onEdit,
}: SamplingRequestPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState<string>("");

  const pendingRequests = requests.filter((r) => r.status === "pending");

  if (pendingRequests.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {pendingRequests.map((request) => {
        const lastMessage = request.params.messages[
          request.params.messages.length - 1
        ];
        const promptText =
          Array.isArray(lastMessage.content)
            ? lastMessage.content[0]?.text || ""
            : lastMessage.content?.text || "";

        const isEditing = editingId === request.id;

        return (
          <Card key={request.id} className="p-4 border-2 border-blue-500/20">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-blue-500/10">
                    Sampling Request
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(request.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!isEditing && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingId(request.id);
                          setEditedPrompt(promptText);
                        }}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => onReject(request.id)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          const params = request.modifiedParams || request.params;
                          onApprove(request.id, params);
                        }}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <Textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    rows={4}
                    className="font-mono text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const modifiedParams: CreateMessageRequestParams = {
                          ...request.params,
                          messages: [
                            ...request.params.messages.slice(0, -1),
                            {
                              ...lastMessage,
                              content: {
                                type: "text",
                                text: editedPrompt,
                              },
                            },
                          ],
                        };
                        onEdit(request.id, modifiedParams);
                        setEditingId(null);
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingId(null);
                        setEditedPrompt("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      Prompt:
                    </div>
                    <div className="p-2 bg-muted rounded text-sm font-mono whitespace-pre-wrap">
                      {promptText}
                    </div>
                  </div>

                  {request.params.systemPrompt && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        System Prompt:
                      </div>
                      <div className="p-2 bg-muted rounded text-sm font-mono whitespace-pre-wrap">
                        {request.params.systemPrompt}
                      </div>
                    </div>
                  )}

                  {request.params.modelPreferences && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        Model Preferences:
                      </div>
                      <div className="p-2 bg-muted rounded text-sm">
                        <JSONDisplay
                          data={request.params.modelPreferences}
                          filename="model-preferences.json"
                        />
                      </div>
                    </div>
                  )}

                  {request.params.maxTokens && (
                    <div className="text-xs text-muted-foreground">
                      Max Tokens: {request.params.maxTokens}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

