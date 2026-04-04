import assert from "assert";
import { 
  TestHelpers,
  Satellite_AgentRegistered
} from "generated";
const { MockDb, Satellite } = TestHelpers;

describe("Satellite contract AgentRegistered event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for Satellite contract AgentRegistered event
  const event = Satellite.AgentRegistered.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("Satellite_AgentRegistered is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await Satellite.AgentRegistered.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualSatelliteAgentRegistered = mockDbUpdated.entities.Satellite_AgentRegistered.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedSatelliteAgentRegistered: Satellite_AgentRegistered = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      agentId: event.params.agentId,
      agentAddress: event.params.agentAddress,
      deployer: event.params.deployer,
      provingAmount: event.params.provingAmount,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualSatelliteAgentRegistered, expectedSatelliteAgentRegistered, "Actual SatelliteAgentRegistered should be the same as the expectedSatelliteAgentRegistered");
  });
});
