import { describe, expect, it } from "vitest";
import { hostPart } from "./addresses";

describe("hostPart (FR-49)", () => {
  it("shows the octets the prefix does not cover", () => {
    expect(hostPart("192.168.0.1/24")).toBe(".1");
    expect(hostPart("192.168.0.1/16")).toBe(".0.1");
    expect(hostPart("10.20.30.40/8")).toBe(".20.30.40");
  });

  it("never cuts an octet in two", () => {
    expect(hostPart("10.1.17.5/20")).toBe(".17.5");
    expect(hostPart("192.168.0.130/25")).toBe(".130");
    expect(hostPart("10.0.0.2/30")).toBe(".2");
  });

  it("shows the last octet of a /31 or /32", () => {
    expect(hostPart("10.0.0.1/31")).toBe(".1");
    expect(hostPart("10.0.0.1/32")).toBe(".1");
  });

  it("shows the whole address when the prefix is shorter than an octet", () => {
    expect(hostPart("10.0.0.1/4")).toBe("10.0.0.1");
  });

  it("takes the prefix from the domain's subnet when the address has none", () => {
    expect(hostPart("192.168.0.1", "192.168.0.0/16")).toBe(".0.1");
    expect(hostPart("192.168.0.1")).toBe(".1");
  });

  it("prefers the address's own prefix to the domain's", () => {
    expect(hostPart("192.168.0.1/24", "192.168.0.0/16")).toBe(".1");
  });

  it("drops leading zeros the way an address is written", () => {
    expect(hostPart("10.0.0.007/24")).toBe(".7");
  });

  it("shows nothing for no address, or one it cannot read", () => {
    expect(hostPart(null)).toBeNull();
    expect(hostPart(undefined)).toBeNull();
    expect(hostPart("")).toBeNull();
    expect(hostPart("abc")).toBeNull();
    expect(hostPart("10.0.0.300/24")).toBeNull();
    expect(hostPart("10.0.0.1/40")).toBeNull();
    expect(hostPart("10.0.0.1/x")).toBeNull();
  });

  it("does the same by groups for IPv6", () => {
    expect(hostPart("2001:db8::1/64")).toBe("::1");
    expect(hostPart("2001:db8:0:1:a:b:c:d/64")).toBe(":a:b:c:d");
    expect(hostPart("2001:db8:0:5::1/56")).toBe(":5:0:0:0:1");
    expect(hostPart("fe80::1/128")).toBe(":1");
    expect(hostPart("2001:db8::/64")).toBe("::0");
    expect(hostPart("2001:db8:::1/64")).toBeNull();
  });
});
