import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./button";
import { Dialog, Drawer } from "./dialog";
import { Field, Input } from "./field";
import { Popover } from "./popover";
import { Segmented } from "./segmented";
import { Tabs } from "./tabs";
import { ToastProvider, useToast } from "./toast";

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

describe("Dialog dirty guard", () => {
  beforeEach(() => {
    // jsdom doesn't implement the modal dialog methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  const cancel = () => {
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
  };

  it("asks before discarding a dirty form on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Edit role" dirty>
        <p>Form</p>
      </Dialog>,
    );
    cancel();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    cancel();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a second Escape dismisses the discard confirmation instead of closing", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Edit role" dirty>
        <p>Form</p>
      </Dialog>,
    );
    cancel();
    expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeInTheDocument();

    // A second Escape returns to editing; edits are not lost.
    cancel();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeInTheDocument();
  });

  it("closes a clean form on Escape without asking", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Edit role" dirty={false}>
        <p>Form</p>
      </Dialog>,
    );
    cancel();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("guards the drawer close button the same way", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Edit role" dirty>
        <p>Form</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeInTheDocument();
  });
});

describe("Toast action", () => {
  it("runs the action and dismisses the toast", async () => {
    const onUndo = vi.fn();
    function Fire() {
      const toast = useToast();
      return (
        <button
          onClick={() =>
            toast.success("report.pdf removed.", { action: { label: "Undo", onClick: onUndo } })
          }
        >
          Remove
        </button>
      );
    }
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeInTheDocument();
    await userEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
