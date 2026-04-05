import assert from "assert";
import { 
  TestHelpers,
  AgentManager_AgentEvicted
} from "generated";
const { MockDb, AgentManager } = TestHelpers;

describe("AgentManager contract AgentEvicted event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for AgentManager contract AgentEvicted event
  const event = AgentManager.AgentEvicted.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("AgentManager_AgentEvicted is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await AgentManager.AgentEvicted.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualAgentManagerAgentEvicted = mockDbUpdated.entities.AgentManager_AgentEvicted.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedAgentManagerAgentEvicted: AgentManager_AgentEvicted = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      agentId: event.params.agentId,
      fullEviction: event.params.fullEviction,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualAgentManagerAgentEvicted, expectedAgentManagerAgentEvicted, "Actual AgentManagerAgentEvicted should be the same as the expectedAgentManagerAgentEvicted");
  });
});
