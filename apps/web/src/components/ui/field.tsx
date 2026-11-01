"use client"

import * as React from "react"

const FieldIdContext = React.createContext<string | undefined>(undefined)

/**
 * Wraps one label + one control: the `Label` inside points at the control (`htmlFor`) and the
 * `Input` / `Textarea` / `SelectTrigger` inside takes the generated id — explicit ids still win.
 */
function Field({ ...props }: React.ComponentProps<"div">) {
  const id = React.useId()
  return (
    <FieldIdContext.Provider value={id}>
      <div data-slot="field" {...props} />
    </FieldIdContext.Provider>
  )
}

function useFieldId() {
  return React.useContext(FieldIdContext)
}

export { Field, useFieldId }
