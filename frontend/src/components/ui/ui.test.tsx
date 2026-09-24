import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./button";
import { Field, Input } from "./field";
import { Popover } from "./popover";
import { Segmented } from "./segmented";
import { Tabs } from "./tabs";

describe("Button", () => {
  it("is disabled and busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives icon buttons an accessible name", () => {
    render(<IconButton label="Close">×</IconButton>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("links the label, error and help text to the control", () => {
    render(
      <Field label="Phone" required help="10 digits" error="Enter a 10-digit number.">
        {(props) => <Input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Phone/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a 10-digit number. 10 digits");
  });

  it("is not marked invalid without an error", () => {
    render(<Field label="Name">{(props) => <Input {...props} />}</Field>);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

function TabsHarness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs
      label="Sections"
      value={value}
      onChange={setValue}
      items={[
        { key: "a", label: "Alpha" },
        { key: "b", label: "Beta" },
        { key: "c", label: "Gamma" },
      ]}
    >
      Panel {value}
    </Tabs>
  );
}

describe("Tabs", () => {
  it("moves with arrow keys, wraps around and supports Home/End", async () => {
    render(<TabsHarness />);
    await userEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel b");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<TabsHarness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
  });
});

describe("Segmented", () => {
  it("behaves as a radio group", async () => {
    function Harness() {
      const [value, setValue] = useState<"x" | "y">("x");
      return (
        <Segmented
          label="Density"
          value={value}
          onChange={setValue}
          options={[
            { value: "x", label: "Comfortable" },
            { value: "y", label: "Compact" },
          ]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Density" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  });
});

describe("Popover", () => {
  it("opens, closes on Escape and returns focus to its button", async () => {
    render(
      <Popover trigger={(props) => <button {...props}>Menu</button>}>
        {() => <p>Panel content</p>}
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Menu" });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Panel content")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
