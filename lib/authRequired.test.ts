import assert from "node:assert/strict";
import test from "node:test";
import { authRequired } from "./authRequired.ts";

test("sign-in runs only when AUTH_REQUIRED is exactly true", () => {
  const previous = process.env.AUTH_REQUIRED;
  const previousPublic = process.env.NEXT_PUBLIC_AUTH_REQUIRED;
  try {
    delete process.env.AUTH_REQUIRED;
    delete process.env.NEXT_PUBLIC_AUTH_REQUIRED;
    assert.equal(authRequired(), false);

    for (const value of ["", "false", "0", "1", "TRUE", "True", "yes"]) {
      process.env.AUTH_REQUIRED = value;
      assert.equal(authRequired(), false, value);
    }

    process.env.AUTH_REQUIRED = "true";
    assert.equal(authRequired(), true);

    delete process.env.AUTH_REQUIRED;
    process.env.NEXT_PUBLIC_AUTH_REQUIRED = "true";
    assert.equal(authRequired(), true);

    process.env.NEXT_PUBLIC_AUTH_REQUIRED = "false";
    assert.equal(authRequired(), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous;
    if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_AUTH_REQUIRED;
    else process.env.NEXT_PUBLIC_AUTH_REQUIRED = previousPublic;
  }
});
