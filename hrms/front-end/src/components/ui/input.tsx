import * as React from "react";
import { Eye, EyeOff, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  sanitizeCodeInput,
  sanitizeDesignationNameInput,
  sanitizeEmailInput,
  sanitizeNameInput,
  sanitizePhoneInput,
  sanitizeSlugInput
} from "@/utils/validators";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type InputProps = React.ComponentProps<"input"> & {
  validationType?: "name" | "designationName" | "email" | "phone" | "code" | "slug";
  infoText?: string;
};

const getValidationMeta = (
  validationType?: InputProps["validationType"],
  rawValue: string = ""
) => {
  if (!validationType) {
    return { sanitizedValue: rawValue, message: "", infoText: "" };
  }

  if (validationType === "name") {
    const sanitizedValue = sanitizeNameInput(rawValue);
    return {
      sanitizedValue,
      message: rawValue !== sanitizedValue ? "Only letters and spaces are allowed" : "",
      infoText: "Use letters and spaces only."
    };
  }

  if (validationType === "designationName") {
    const sanitizedValue = sanitizeDesignationNameInput(rawValue);
    return {
      sanitizedValue,
      message: rawValue !== sanitizedValue ? "Only letters, spaces, & and - are allowed" : "",
      infoText: "Use letters, spaces, & and - only."
    };
  }

  if (validationType === "email") {
    const sanitizedValue = sanitizeEmailInput(rawValue);
    return {
      sanitizedValue,
      message: rawValue !== sanitizedValue ? "Email cannot contain spaces and will be lowercase" : "",
      infoText: "Spaces are removed and email is stored in lowercase."
    };
  }

  if (validationType === "phone") {
    const sanitizedValue = sanitizePhoneInput(rawValue);
    return {
      sanitizedValue,
      message: rawValue !== sanitizedValue ? "Only digits are allowed" : "",
      infoText: "Use digits only."
    };
  }

  if (validationType === "code") {
    const sanitizedValue = sanitizeCodeInput(rawValue);
    return {
      sanitizedValue,
      message: rawValue !== sanitizedValue ? "Only A-Z, 0-9, _ and - are allowed" : "",
      infoText: "Allowed characters: A-Z, 0-9, underscore and hyphen."
    };
  }

  const sanitizedValue = sanitizeSlugInput(rawValue);
  return {
    sanitizedValue,
    message: rawValue !== sanitizedValue ? "Only lowercase letters, numbers and _ are allowed" : "",
    infoText: "Use lowercase letters, numbers and underscore only."
  };
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, validationType, onChange, infoText, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [validationMessage, setValidationMessage] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const isPasswordField = type === "password";
    const resolvedType = isPasswordField && showPassword ? "text" : type;
    const resolvedInfoText = infoText || getValidationMeta(validationType).infoText;

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

    React.useEffect(() => {
      const node = inputRef.current;
      if (!node || resolvedType !== "number") {
        return;
      }

      const preventWheelStep = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };

      node.addEventListener("wheel", preventWheelStep, { passive: false });
      return () => {
        node.removeEventListener("wheel", preventWheelStep);
      };
    }, [resolvedType]);

    React.useEffect(() => {
      if (!validationType || typeof props.value !== "string") {
        return;
      }

      const { sanitizedValue } = getValidationMeta(validationType, props.value);
      if (sanitizedValue === props.value) {
        setValidationMessage("");
      }
    }, [props.value, validationType]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!validationType) {
        onChange?.(event);
        return;
      }

      const rawValue = event.target.value;
      const { sanitizedValue: nextValue, message: nextMessage } = getValidationMeta(validationType, rawValue);

      setValidationMessage(nextMessage);
      if (nextValue !== rawValue) {
        event.target.value = nextValue;
      }

      onChange?.(event);
    };

    const inputClassName = cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      (resolvedInfoText || isPasswordField) ? "pr-10" : "",
      resolvedInfoText && isPasswordField ? "pr-16" : "",
      className,
    );

    const infoAdornment = resolvedInfoText ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "absolute top-1/2 -translate-y-1/2 text-muted-foreground cursor-help",
              isPasswordField ? "right-10" : "right-3"
            )}
            aria-label="Validation information"
          >
            <Info className="h-4 w-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{resolvedInfoText}</TooltipContent>
      </Tooltip>
    ) : null;

    if (!isPasswordField) {
      if (!validationType && !resolvedInfoText) {
        return (
          <input
            type={resolvedType}
            className={inputClassName}
            ref={inputRef}
            onChange={handleChange}
            {...props}
          />
        );
      }
      return (
        <div className="w-full">
          <div className="relative">
            <input
              type={resolvedType}
              className={inputClassName}
              ref={inputRef}
              onChange={handleChange}
              {...props}
            />
            {infoAdornment}
          </div>
          {validationType && validationMessage ? (
            <p className="mt-1 text-xs text-red-600">{validationMessage}</p>
          ) : null}
        </div>
      );
    }

    if (!validationType) {
      return (
        <div className="relative">
          <input
            type={resolvedType}
            className={inputClassName}
            ref={inputRef}
            onChange={handleChange}
            {...props}
          />
          {infoAdornment}
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      );
    }

    return (
      <div className="w-full">
        <div className="relative">
          <input
            type={resolvedType}
            className={inputClassName}
            ref={inputRef}
            onChange={handleChange}
            {...props}
          />
          {infoAdornment}
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {validationType && validationMessage ? (
          <p className="mt-1 text-xs text-red-600">{validationMessage}</p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
