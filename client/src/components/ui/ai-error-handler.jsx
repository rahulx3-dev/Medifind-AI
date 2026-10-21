import React, { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle, Info, Bell, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/ai-error-handler-utils/alert";
import { Button } from "@/components/ui/ai-error-handler-utils/button";

function getErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || "An error occurred";
}

export default function AIErrorHandler({
  error,
  title = "An Error Occurred",
  variant = "destructive",
  onRetry,
  onDismiss,
  className,
  action,
}) {
  const [isRetrying, setIsRetrying] = useState(false);

  const message = getErrorMessage(error);

  const handleRetry = useCallback(async () => {
    if (!onRetry) return;

    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  }, [onRetry]);

  if (!(error && message)) return null;

  const renderIcon = () => {
    switch (variant) {
      case "success":
        return <CheckCircle aria-hidden="true" className="size-4 shrink-0 text-[#006a5c]" />;
      case "warning":
        return <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-[#d97706]" />;
      case "info":
        return <Info aria-hidden="true" className="size-4 shrink-0 text-[#0284c7]" />;
      case "destructive":
      default:
        return <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-[#ba1a1a]" />;
    }
  };

  return (
    <Alert
      className={cn("w-full transition-all duration-200", className)}
      live="assertive"
      variant={variant}
    >
      {renderIcon()}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1 pr-2">
            <AlertTitle className="wrap-break-word font-bold text-sm sm:text-base leading-snug">
              {title}
            </AlertTitle>
            <AlertDescription className="wrap-break-word text-xs sm:text-sm">
              {message}
            </AlertDescription>
          </div>
          {onDismiss && (
            <Button
              aria-label="Dismiss alert"
              className="min-h-[32px] min-w-[32px] shrink-0 touch-manipulation hover:bg-black/5 dark:hover:bg-white/10"
              onClick={onDismiss}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>

        {action && <div className="mt-1">{action}</div>}

        {onRetry && (
          <Button
            aria-busy={isRetrying}
            className="ml-auto min-h-[32px] w-fit touch-manipulation sm:ml-0 gap-1.5"
            data-loading={isRetrying}
            disabled={isRetrying}
            onClick={handleRetry}
            type="button"
            variant="secondary"
          >
            {isRetrying ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                <span>Retrying…</span>
              </>
            ) : (
              <>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                <span>Retry</span>
              </>
            )}
          </Button>
        )}
      </div>
    </Alert>
  );
}
